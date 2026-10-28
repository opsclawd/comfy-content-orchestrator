import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TEACACHE_DIR = resolve("experiments/minimax-h3-teacache");

function runPythonTest(code: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("python3", ["-c", code], {
    env: {
      ...process.env,
      PYTHONPATH: TEACACHE_DIR
    },
    encoding: "utf-8"
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

describe("MiniMax-H3 TeaCache Python Implementation", () => {
  describe("TeaCacheSession Parameter Validation & Boundaries", () => {
    it("accepts allowlisted thresholds (0.05, 0.1, 0.15) with 20 steps", () => {
      const code = `
import teacache

for thresh in (0.05, 0.1, 0.15):
    sess = teacache.TeaCacheSession(
        session_id="test-sess",
        model_id="test-model",
        rel_l1_thresh=thresh,
        start_step=2,
        end_step=-2,
        total_steps=20,
        sigmas=list(range(21, 0, -1))
    )
    assert sess.rel_l1_thresh == thresh
    assert sess.total_steps == 20
    assert sess.start_step == 2
    assert sess.end_step == 18
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("requires a sigma schedule and rejects omitted sigmas (issue #467)", () => {
      const code = `
import teacache

try:
    teacache.TeaCacheSession(
        session_id="test-sess",
        model_id="test-model",
        rel_l1_thresh=0.15,
        start_step=2,
        end_step=-2,
        total_steps=20
    )
    assert False, "Expected ValueError when sigmas is omitted"
except ValueError as e:
    assert "sigmas schedule is required" in str(e)
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects unallowlisted, non-finite, and invalid thresholds", () => {
      const code = `
import teacache
import math

invalid_thresholds = [0.0, 0.08, 0.2, -0.15, float("inf"), float("-inf"), float("nan"), "0.15", None]

for t in invalid_thresholds:
    try:
        teacache.TeaCacheSession(
            session_id="test-sess",
            model_id="test-model",
            rel_l1_thresh=t,
            start_step=2,
            end_step=-2,
            total_steps=20
        )
        assert False, f"Expected ValueError for threshold {t}"
    except (ValueError, TypeError):
        pass
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects total_steps != 20 or non-integer total_steps", () => {
      const code = `
import teacache

invalid_steps = [10, 15, 25, 4, "20", 20.0, None]

for s in invalid_steps:
    try:
        teacache.TeaCacheSession(
            session_id="test-sess",
            model_id="test-model",
            rel_l1_thresh=0.15,
            start_step=2,
            end_step=-2,
            total_steps=s
        )
        assert False, f"Expected ValueError for total_steps {s}"
    except (ValueError, TypeError):
        pass
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects invalid windows where start_step >= end_step", () => {
      const code = `
import teacache

try:
    teacache.TeaCacheSession(
        session_id="test-sess",
        model_id="test-model",
        rel_l1_thresh=0.15,
        start_step=15,
        end_step=10,
        total_steps=20,
        sigmas=list(range(21, 0, -1))
    )
    assert False, "Expected ValueError for start_step >= end_step"
except ValueError as e:
    assert "Invalid step window" in str(e)
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });
  });

  describe("TeaCacheSession Step Sequencing & State Isolation", () => {
    it("enforces strict sequential step advancement and rejects jumps or duplicates", () => {
      const code = `
import teacache

sess = teacache.TeaCacheSession(
    session_id="test-seq",
    model_id="test-model",
    rel_l1_thresh=0.15,
    start_step=2,
    end_step=-2,
    total_steps=20,
    sigmas=list(range(21, 0, -1))
)

# Step 0 ok
sess.advance_step(0)

# Duplicate step 0 must fail
try:
    sess.advance_step(0)
    assert False, "Expected ValueError on duplicate step 0"
except ValueError as e:
    assert "repeat" in str(e).lower() or "backwards" in str(e).lower()

# Skipping step 1 directly to step 2 must fail
try:
    sess.advance_step(2)
    assert False, "Expected ValueError on non-sequential step jump"
except ValueError as e:
    assert "jumped" in str(e).lower() or "non-sequentially" in str(e).lower()

# Sequential step 1 ok
sess.advance_step(1)
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("clones cached tensor outputs on hit and evaluate to prevent mutation", () => {
      const code = `
import teacache

class MockFloat:
    def __init__(self, val):
        self.val = val
    def item(self):
        return self.val
    def __truediv__(self, other):
        v = other.val if isinstance(other, MockFloat) else other
        return MockFloat(self.val / v)
    def __add__(self, other):
        v = other.val if isinstance(other, MockFloat) else other
        return MockFloat(self.val + v)

class MockTensor:
    def __init__(self, val, mean_val=1.0):
        self.val = val
        self.mean_val = mean_val
        self.cloned = False
        self.shape = (1, 16, 20, 20)
        self.dtype = "float32"
        self.device = "cuda:0"

    def detach(self):
        return self

    def float(self):
        return self

    def clone(self):
        c = MockTensor(self.val, self.mean_val)
        c.cloned = True
        return c

    def abs(self):
        return self

    def mean(self):
        return MockFloat(self.mean_val)

    def __sub__(self, other):
        return MockTensor("sub", mean_val=0.0001)

sess = teacache.TeaCacheSession(
    session_id="test-clone",
    model_id="test-model",
    rel_l1_thresh=0.15,
    start_step=2,
    end_step=-2,
    total_steps=20,
    sigmas=list(range(21, 0, -1))
)

# Advance steps 0 and 1 (before window)
sess.advance_step(0)
sess.advance_step(1)

# Step 2: first window step, full forward pass
sess.advance_step(2)
out1 = sess.evaluate(lambda inp, **kw: MockTensor("out1"), {"input": MockTensor("inp1"), "timestep": 19.0})
assert sess.last_real_output is not None
assert sess.last_real_output.cloned is True

# Step 3: cache hit (accumulated rel_l1 0.01 < 0.15)
sess.advance_step(3)
out2 = sess.evaluate(lambda inp, **kw: MockTensor("out2"), {"input": MockTensor("inp2"), "timestep": 18.0})

# Assert that out2 is a cloned copy, not identical reference
assert out2.cloned is True
assert out2 is not sess.last_real_output
assert sess.cache_hits_count == 1
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("isolates active sessions and prevents concurrent or uncleaned sessions", () => {
      const code = `
import teacache

sigmas = list(range(21, 0, -1))
sess1 = teacache.TeaCacheSession("s1", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
sess2 = teacache.TeaCacheSession("s2", "m2", 0.15, 2, -2, 20, sigmas=sigmas)

tok1 = teacache.set_active_session(sess1)
assert teacache.get_active_session() is sess1

# Reset session
teacache.reset_active_session(tok1)
assert teacache.get_active_session() is None

# Now setting sess2 succeeds
tok2 = teacache.set_active_session(sess2)
assert teacache.get_active_session() is sess2
teacache.reset_active_session(tok2)
assert teacache.get_active_session() is None
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects a second session activation for the same model_id while one is already active (issue #467)", () => {
      const code = `
import teacache

sigmas = list(range(21, 0, -1))
sess_a = teacache.TeaCacheSession("s-a", "shared-model", 0.15, 2, -2, 20, sigmas=sigmas)
sess_b = teacache.TeaCacheSession("s-b", "shared-model", 0.15, 2, -2, 20, sigmas=sigmas)

tok_a = teacache.set_active_session(sess_a)
try:
    teacache.set_active_session(sess_b)
    assert False, "Expected RuntimeError on same-model nested session activation"
except RuntimeError as e:
    assert "already active for model_id" in str(e)
finally:
    teacache.reset_active_session(tok_a)
    sess_a.cleanup()

# After sess_a.cleanup() releases the model_id, a new session for the same
# model_id may be activated.
tok_b = teacache.set_active_session(sess_b)
assert teacache.get_active_session() is sess_b
teacache.reset_active_session(tok_b)
sess_b.cleanup()
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("does not let a rejected session's cleanup() evict a different session's legitimate ownership lock (issue #467)", () => {
      const code = `
import teacache

sigmas = list(range(21, 0, -1))
sess_a = teacache.TeaCacheSession("s-owner", "shared-model", 0.15, 2, -2, 20, sigmas=sigmas)
sess_b = teacache.TeaCacheSession("s-rejected", "shared-model", 0.15, 2, -2, 20, sigmas=sigmas)
sess_c = teacache.TeaCacheSession("s-also-rejected", "shared-model", 0.15, 2, -2, 20, sigmas=sigmas)

tok_a = teacache.set_active_session(sess_a)

# sess_b's activation is correctly rejected...
try:
    teacache.set_active_session(sess_b)
    assert False, "Expected RuntimeError"
except RuntimeError:
    pass

# ...and the real collector hook's finally block calls cleanup()
# unconditionally on whatever session object it constructed, win or lose.
# This must be a no-op for sess_b's slot -- it never actually held the
# lock -- and must NOT evict sess_a's still-active lock.
sess_b.cleanup()

# Proof: a third session on the same model_id is STILL rejected, meaning
# sess_a's lock survived sess_b's cleanup() intact.
try:
    teacache.set_active_session(sess_c)
    assert False, "Expected RuntimeError -- sess_a's lock must still be held"
except RuntimeError as e:
    assert "already active for model_id" in str(e)

teacache.reset_active_session(tok_a)
sess_a.cleanup()
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("binds a session to the conditioning manifest shape seen on its first evaluate call and rejects a later change (issue #467)", () => {
      const code = `
import teacache

class MockTensor:
    def __init__(self):
        self.shape = (1, 16, 20, 20)
        self.dtype = "float32"
        self.device = "cuda:0"
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

sigmas = list(range(21, 0, -1))
sess = teacache.TeaCacheSession("s-cond", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
sess.advance_step(0)

# First call establishes the conditioning fingerprint.
out1 = sess.evaluate(
    lambda inp, **kw: MockTensor(),
    {"input": MockTensor(), "timestep": 21.0, "c": {"cross_attention": "x"}}
)

sess.advance_step(1)
try:
    # A different set of conditioning keys mid-session must be rejected --
    # reusing a cached forward output computed under a different route
    # would be silently wrong.
    sess.evaluate(
        lambda inp, **kw: MockTensor(),
        {"input": MockTensor(), "timestep": 20.0, "c": {"cross_attention": "x", "extra_key": "y"}}
    )
    assert False, "Expected RuntimeError on conditioning manifest change"
except RuntimeError as e:
    assert "Conditioning manifest changed mid-session" in str(e)
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects a changed latent_shapes or minimax_payload value even when the conditioning key set is identical (issue #467)", () => {
      const code = `
import teacache

class MockTensor:
    def __init__(self):
        self.shape = (1, 16, 20, 20)
        self.dtype = "float32"
        self.device = "cuda:0"
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

sigmas = list(range(21, 0, -1))

# Case 1: latent_shapes value changes, same keys.
sess1 = teacache.TeaCacheSession("s-latent", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
sess1.advance_step(0)
sess1.evaluate(
    lambda inp, **kw: MockTensor(),
    {"input": MockTensor(), "timestep": 21.0, "c": {"latent_shapes": (1, 16, 20, 20), "minimax_payload": {"tokens": 512}}}
)
sess1.advance_step(1)
try:
    sess1.evaluate(
        lambda inp, **kw: MockTensor(),
        {"input": MockTensor(), "timestep": 20.0, "c": {"latent_shapes": (1, 16, 40, 40), "minimax_payload": {"tokens": 512}}}
    )
    assert False, "Expected RuntimeError on changed latent_shapes value"
except RuntimeError as e:
    assert "Conditioning manifest changed mid-session" in str(e)

# Case 2: minimax_payload value changes, same keys.
sess2 = teacache.TeaCacheSession("s-payload", "m2", 0.15, 2, -2, 20, sigmas=sigmas)
sess2.advance_step(0)
sess2.evaluate(
    lambda inp, **kw: MockTensor(),
    {"input": MockTensor(), "timestep": 21.0, "c": {"latent_shapes": (1, 16, 20, 20), "minimax_payload": {"tokens": 512}}}
)
sess2.advance_step(1)
try:
    sess2.evaluate(
        lambda inp, **kw: MockTensor(),
        {"input": MockTensor(), "timestep": 20.0, "c": {"latent_shapes": (1, 16, 20, 20), "minimax_payload": {"tokens": 999}}}
    )
    assert False, "Expected RuntimeError on changed minimax_payload value"
except RuntimeError as e:
    assert "Conditioning manifest changed mid-session" in str(e)

print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects an in-place mutation of the original latent_shapes/minimax_payload object after it was captured (issue #467)", () => {
      const code = `
import teacache

class MockTensor:
    def __init__(self):
        self.shape = (1, 16, 20, 20)
        self.dtype = "float32"
        self.device = "cuda:0"
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

sigmas = list(range(21, 0, -1))
sess = teacache.TeaCacheSession("s-mutation", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
sess.advance_step(0)

# A real adversarial probe: the caller reuses the SAME mutable list/dict
# objects across calls (a common buffer-reuse pattern) rather than
# constructing fresh ones. The fingerprint captured at step 0 must not
# alias these -- mutating them afterward must not retroactively make a
# later, genuinely-different conditioning compare as unchanged.
shared_latent_shapes = [1, 16, 20, 20]
shared_payload = {"tokens": 512}

sess.evaluate(
    lambda inp, **kw: MockTensor(),
    {"input": MockTensor(), "timestep": 21.0, "c": {"latent_shapes": shared_latent_shapes, "minimax_payload": shared_payload}}
)

# Mutate the SAME objects in place after capture.
shared_latent_shapes[2] = 999
shared_payload["tokens"] = 999

sess.advance_step(1)
try:
    sess.evaluate(
        lambda inp, **kw: MockTensor(),
        {"input": MockTensor(), "timestep": 20.0, "c": {"latent_shapes": shared_latent_shapes, "minimax_payload": shared_payload}}
    )
    assert False, "Expected RuntimeError: the mutated conditioning must still be detected as changed"
except RuntimeError as e:
    assert "Conditioning manifest changed mid-session" in str(e)

print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects a same-shaped reference/cross_attention tensor whose actual content changed (issue #467)", () => {
      const code = `
import teacache

class MockTensor:
    def __init__(self):
        self.shape = (1, 16, 20, 20)
        self.dtype = "float32"
        self.device = "cuda:0"
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

# A tensor-like object with a real .equal() method, as actual torch
# tensors have (returning a plain bool, unlike __eq__ which returns an
# elementwise tensor). Same shape/dtype/device every time -- only the
# payload content ("val") differs between the two instances below.
class MockContentTensor:
    def __init__(self, val):
        self.val = val
        self.shape = (4, 768)
        self.dtype = "float32"
        self.device = "cuda:0"
    def detach(self): return self
    def clone(self): return MockContentTensor(self.val)
    def equal(self, other):
        return isinstance(other, MockContentTensor) and self.val == other.val

sigmas = list(range(21, 0, -1))
sess = teacache.TeaCacheSession("s-tensor-content", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
sess.advance_step(0)

sess.evaluate(
    lambda inp, **kw: MockTensor(),
    {"input": MockTensor(), "timestep": 21.0, "c": {"cross_attention": MockContentTensor("embedding-A")}}
)

sess.advance_step(1)
try:
    # Same shape/dtype/device, genuinely different content -- this is the
    # exact gap a shape/dtype/device-only fingerprint leaves open: a
    # different reference embedding with identical metadata must still be
    # rejected as a conditioning change.
    sess.evaluate(
        lambda inp, **kw: MockTensor(),
        {"input": MockTensor(), "timestep": 20.0, "c": {"cross_attention": MockContentTensor("embedding-B")}}
    )
    assert False, "Expected RuntimeError: same-shaped tensor with different content must be rejected"
except RuntimeError as e:
    assert "Conditioning manifest changed mid-session" in str(e)

print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects two distinct tensor-likes that both fail to clone, instead of treating unverifiable content as equal (issue #467)", () => {
      const code = `
import teacache

class MockTensor:
    def __init__(self):
        self.shape = (1, 16, 20, 20)
        self.dtype = "float32"
        self.device = "cuda:0"
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

# No .detach()/.clone() at all, so _snapshot_for_fingerprint can never
# capture a content clone for either call -- both snapshots end up with
# clone=None. A prior version of the comparator treated "both None" as
# equal regardless of whether the two objects were the same one, which
# is a fail-OPEN bug: it let two completely different, unverifiable
# tensor-likes silently compare as unchanged.
class UncloneableTensor:
    def __init__(self):
        self.shape = (4, 768)
        self.dtype = "float32"
        self.device = "cuda:0"

sigmas = list(range(21, 0, -1))
sess = teacache.TeaCacheSession("s-uncloneable", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
sess.advance_step(0)

sess.evaluate(
    lambda inp, **kw: MockTensor(),
    {"input": MockTensor(), "timestep": 21.0, "c": {"cross_attention": UncloneableTensor()}}
)

sess.advance_step(1)
try:
    # A genuinely different UncloneableTensor instance -- unverifiable,
    # so it must be rejected rather than assumed unchanged.
    sess.evaluate(
        lambda inp, **kw: MockTensor(),
        {"input": MockTensor(), "timestep": 20.0, "c": {"cross_attention": UncloneableTensor()}}
    )
    assert False, "Expected RuntimeError: unverifiable tensor-likes must not compare as equal"
except RuntimeError as e:
    assert "Conditioning manifest changed mid-session" in str(e)

print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects the literal SAME uncloneable tensor-like object reused across calls while mutated in place (issue #467)", () => {
      const code = `
import teacache

class MockTensor:
    def __init__(self):
        self.shape = (1, 16, 20, 20)
        self.dtype = "float32"
        self.device = "cuda:0"
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

# No .detach()/.clone() -- content can never be verified. A prior
# version of the comparator fell back to "is the literal same object"
# as proof of "unchanged", which is unsafe: the caller can hand back
# this exact object on every call while mutating its contents in place
# between calls, and reference identity alone cannot see that at all.
class UncloneableMutableTensor:
    def __init__(self, val):
        self.val = val
        self.shape = (4, 768)
        self.dtype = "float32"
        self.device = "cuda:0"

shared = UncloneableMutableTensor("embedding-A")

sigmas = list(range(21, 0, -1))
sess = teacache.TeaCacheSession("s-same-object-mutation", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
sess.advance_step(0)

sess.evaluate(
    lambda inp, **kw: MockTensor(),
    {"input": MockTensor(), "timestep": 21.0, "c": {"cross_attention": shared}}
)

# Mutate the SAME object's content in place, then pass the SAME
# reference again -- an identity-based fallback would see "same object"
# and wrongly conclude "unchanged".
shared.val = "embedding-B"

sess.advance_step(1)
try:
    sess.evaluate(
        lambda inp, **kw: MockTensor(),
        {"input": MockTensor(), "timestep": 20.0, "c": {"cross_attention": shared}}
    )
    assert False, "Expected RuntimeError: unverifiable content must fail closed even for the same object reference"
except RuntimeError as e:
    assert "Conditioning manifest changed mid-session" in str(e)

print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects an unsupported conditioning payload type instead of silently passing it through unverified (issue #467)", () => {
      const code = `
import teacache

class MockTensor:
    def __init__(self):
        self.shape = (1, 16, 20, 20)
        self.dtype = "float32"
        self.device = "cuda:0"
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

# A custom object that is none of None/bool/int/float/str, dict,
# list/tuple, or tensor-like (no .shape/.dtype). Its default __eq__ is
# identity-based, so a prior version of this code (which fell through to
# a raw passthrough for "unsupported" values) would let this same
# object, even if mutated in place between calls, silently compare as
# unchanged. Must instead be rejected outright at fingerprinting time.
class UnsupportedPayload:
    def __init__(self, val):
        self.val = val

sigmas = list(range(21, 0, -1))
sess = teacache.TeaCacheSession("s-unsupported", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
sess.advance_step(0)

try:
    sess.evaluate(
        lambda inp, **kw: MockTensor(),
        {"input": MockTensor(), "timestep": 21.0, "c": {"custom": UnsupportedPayload("v1")}}
    )
    assert False, "Expected ValueError: unsupported conditioning payload type must be rejected"
except ValueError as e:
    assert "Unsupported conditioning value type" in str(e)

print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });
  });

  describe("CCOMiniMaxH3TeaCacheNode ComfyUI Wrapper & Model Verification", () => {
    it("validates node metadata and input types schema", () => {
      const code = `
import nodes

node = nodes.CCOMiniMaxH3TeaCacheNode()
input_types = nodes.CCOMiniMaxH3TeaCacheNode.INPUT_TYPES()
assert "required" in input_types
req = input_types["required"]
assert "model" in req
assert "rel_l1_thresh" in req
assert "start_step" in req
assert "end_step" in req
assert "total_steps" in req
assert nodes.CCOMiniMaxH3TeaCacheNode.RETURN_TYPES == ("MODEL",)
assert nodes.CCOMiniMaxH3TeaCacheNode.CATEGORY == "model_patches/unet"
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects unallowlisted thresholds at node execution time", () => {
      const code = `
import nodes
import math

node = nodes.CCOMiniMaxH3TeaCacheNode()

class MockModelPatcher:
    pass

model = MockModelPatcher()

for bad in [0.08, float("nan"), float("inf"), True, False, "0.15", None]:
    try:
        node.apply(model, rel_l1_thresh=bad, start_step=2, end_step=-2, total_steps=20)
        assert False, f"Expected ValueError/TypeError on invalid threshold {bad}"
    except (ValueError, TypeError):
        pass
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("rejects multi-branch duplicate evaluations within the same step interval", () => {
      const code = `
import teacache

class MockTensor:
    def __init__(self):
        self.shape = (1, 16, 20, 20)
        self.dtype = "float32"
        self.device = "cuda:0"
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

sigmas = list(range(21, 0, -1))
sess = teacache.TeaCacheSession("s-multi", model_id="m1", rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20, sigmas=sigmas)
sess.advance_step(0)

# First evaluation in step 0 succeeds
out1 = sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 21.0})

# Second evaluation in step 0 must fail (multi-branch / duplicate rejection)
try:
    sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 21.0})
    assert False, "Expected RuntimeError on duplicate evaluation in step 0"
except RuntimeError as e:
    assert "Duplicate or multi-branch evaluation detected" in str(e)

# Advance to step 1: evaluation succeeds again
sess.advance_step(1)
out2 = sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 20.0})
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("verifies active session model ownership and parameter match", () => {
      const code = `
import nodes
import teacache

node = nodes.CCOMiniMaxH3TeaCacheNode()

class MockModelPatcher:
    def __init__(self):
        self.wrapper = None

    def clone(self):
        c = MockModelPatcher()
        c.wrapper = self.wrapper
        return c

    def set_model_unet_function_wrapper(self, wrapper):
        self.wrapper = wrapper

m1 = MockModelPatcher()
m2 = MockModelPatcher()

# Patch m1 with threshold 0.15
res1 = node.apply(m1, rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20)
m1_patched = res1[0]
w1 = m1_patched.wrapper
assert w1 is not None

# 1. Calling wrapper without active session must fail
try:
    w1(lambda inp: inp, {"input": "test"})
    assert False, "Expected RuntimeError when no active session"
except RuntimeError as e:
    assert "without an active execution session" in str(e)

sigmas = list(range(21, 0, -1))

# 2. Register session bound to different model_id (id of m2)
sess_m2 = teacache.TeaCacheSession("s-m2", model_id=id(m2), rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20, sigmas=sigmas)
tok2 = teacache.set_active_session(sess_m2)
try:
    w1(lambda inp: inp, {"input": "test"})
    assert False, "Expected RuntimeError on model_id mismatch"
except RuntimeError as e:
    assert "model_id mismatch" in str(e)
finally:
    teacache.reset_active_session(tok2)

# 3. Register session bound to m1_patched but with different threshold (0.10)
sess_diff_thresh = teacache.TeaCacheSession("s-diff", model_id=id(m1_patched), rel_l1_thresh=0.10, start_step=2, end_step=-2, total_steps=20, sigmas=sigmas)
tok3 = teacache.set_active_session(sess_diff_thresh)
try:
    w1(lambda inp: inp, {"input": "test"})
    assert False, "Expected RuntimeError on threshold mismatch"
except RuntimeError as e:
    assert "rel_l1_thresh does not match" in str(e)
finally:
    teacache.reset_active_session(tok3)

print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });
  });

  describe("TeaCacheSession Lifecycle, Timestep Alignment & Error Recovery", () => {
    it("validates sigma schedule and rejects invalid length, non-finite, or non-descending sigmas", () => {
      const code = `
import teacache

# Valid sigmas: 21 strictly descending finite values
valid_sigmas = list(range(21, 0, -1))
sess = teacache.TeaCacheSession("s-sigmas", "m1", 0.15, 2, -2, 20, sigmas=valid_sigmas)
assert sess.sigmas == [float(s) for s in valid_sigmas]

# Reject wrong length (20 instead of 21)
try:
    teacache.TeaCacheSession("s-bad-len", "m1", 0.15, 2, -2, 20, sigmas=list(range(20, 0, -1)))
    assert False, "Expected ValueError on wrong sigmas length"
except ValueError as e:
    assert "Expected schedule with 21 sigmas" in str(e)

# Reject non-descending sigmas
try:
    non_desc = list(range(21, 0, -1))
    non_desc[5] = non_desc[4] + 1  # not descending
    teacache.TeaCacheSession("s-non-desc", "m1", 0.15, 2, -2, 20, sigmas=non_desc)
    assert False, "Expected ValueError on non-descending sigmas"
except ValueError as e:
    assert "strictly descending" in str(e)

# Reject non-finite sigmas
try:
    bad_sigmas = list(range(21, 0, -1))
    bad_sigmas[3] = float("nan")
    teacache.TeaCacheSession("s-nan", "m1", 0.15, 2, -2, 20, sigmas=bad_sigmas)
    assert False, "Expected ValueError on NaN sigma"
except ValueError as e:
    assert "non-finite" in str(e)

print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("validates timestep alignment against schedule and rejects mismatches", () => {
      const code = `
import teacache

class MockTensor:
    def __init__(self):
        self.shape = (1, 16, 20, 20)
        self.dtype = "float32"
        self.device = "cuda:0"
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

sigmas = [float(20 - i) for i in range(21)]
sess = teacache.TeaCacheSession("s-ts", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
sess.advance_step(0)

# Timestep matching sigmas[0] (20.0) succeeds
out1 = sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 20.0})

# Timestep mismatching sigmas[1] (e.g. 5.0 instead of 19.0) raises ValueError
sess.advance_step(1)
try:
    sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 5.0})
    assert False, "Expected ValueError on mismatched timestep"
except ValueError as e:
    assert "does not match expected schedule sigma" in str(e)

print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("cleans up state properly on exception and releases tensor references", () => {
      const code = `
import teacache

class MockTensor:
    def __init__(self):
        self.shape = (1, 16, 20, 20)
        self.dtype = "float32"
        self.device = "cuda:0"
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

sess = teacache.TeaCacheSession("s-err", "m1", 0.15, 2, -2, 20, sigmas=list(range(21, 0, -1)))
sess.advance_step(0)

def failing_forward(inp, **kw):
    raise RuntimeError("Synthetic model crash")

try:
    sess.evaluate(failing_forward, {"input": MockTensor(), "timestep": 21.0})
    assert False, "Expected forward failure"
except RuntimeError as e:
    assert "Synthetic model crash" in str(e)

# Verify is_evaluating lock was released in finally
assert sess.is_evaluating is False

# Clean up session
sess.cleanup()
assert sess.is_active is False
assert sess.last_real_input is None
assert sess.last_real_output is None

# Operations on cleaned-up session fail
try:
    sess.advance_step(1)
    assert False, "Expected RuntimeError on inactive session"
except RuntimeError as e:
    assert "inactive or cleaned-up" in str(e)

print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("resolves package-style custom_nodes adapter module and binds session ContextVar across wrapper", () => {
      const code = `
import importlib.util
import os
import sys

pkg_dir = os.path.abspath('experiments/minimax-h3-teacache')
init_file = os.path.join(pkg_dir, '__init__.py')
spec = importlib.util.spec_from_file_location('custom_nodes_teacache', init_file, submodule_search_locations=[pkg_dir])
pkg = importlib.util.module_from_spec(spec)
sys.modules['custom_nodes_teacache'] = pkg
spec.loader.exec_module(pkg)

node_cls = pkg.NODE_CLASS_MAPPINGS['CCOMiniMaxH3TeaCache']
node = node_cls()

class MockModel:
    def __init__(self):
        self.model_options = {}
    def set_model_unet_function_wrapper(self, w):
        self.model_options['model_function_wrapper'] = w

m = MockModel()
node.apply(m, rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20)

collector_path = os.path.abspath('packages/infrastructure/src/experiments/minimax-h3-collector.py')
c_spec = importlib.util.spec_from_file_location('collector_mod', collector_path)
c_mod = importlib.util.module_from_spec(c_spec)
c_spec.loader.exec_module(c_mod)

resolved_mod = c_mod._resolve_teacache_module(model_patcher=m)
assert resolved_mod is not None, 'resolved_mod is None'
assert resolved_mod is pkg._teacache_mod, f'Module mismatch: {resolved_mod} vs {pkg._teacache_mod}'

sess = resolved_mod.TeaCacheSession('test-pkg', id(m), 0.15, 2, -2, 20, sigmas=list(range(21, 0, -1)))
tok = resolved_mod.set_active_session(sess)

wrapper = m.model_options['model_function_wrapper']
sess.advance_step(0)

class MockTensor:
    def __init__(self): self.shape = (1, 16, 20, 20); self.dtype = 'float32'; self.device = 'cuda:0'
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

out = wrapper(lambda inp, **kw: MockTensor(), {'input': MockTensor(), 'timestep': 21.0})
assert out is not None
assert sess.forward_calls_count == 1
resolved_mod.reset_active_session(tok)
sess.cleanup()
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });

    it("unpacks pinned wrapper API envelope and passes strict H3 conditioning to apply_model", () => {
      const code = `
import importlib.util
import os
import sys

pkg_dir = os.path.abspath('experiments/minimax-h3-teacache')
init_file = os.path.join(pkg_dir, '__init__.py')
spec = importlib.util.spec_from_file_location('custom_nodes_h3_tc', init_file, submodule_search_locations=[pkg_dir])
pkg = importlib.util.module_from_spec(spec)
sys.modules['custom_nodes_h3_tc'] = pkg
spec.loader.exec_module(pkg)

node_cls = pkg.NODE_CLASS_MAPPINGS['CCOMiniMaxH3TeaCache']
node = node_cls()

class MockModel:
    def __init__(self):
        self.model_options = {}
    def set_model_unet_function_wrapper(self, w):
        self.model_options['model_function_wrapper'] = w

m = MockModel()
node.apply(m, rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20)

wrapper = m.model_options['model_function_wrapper']

sigmas = [float(20 - i) for i in range(21)]
sess = pkg.TeaCacheSession('test-h3-cond', id(m), 0.15, 2, -2, 20, sigmas=sigmas)
tok = pkg.set_active_session(sess)
sess.advance_step(0)

class MockTensor:
    def __init__(self): self.shape = (1, 16, 20, 20); self.dtype = 'float32'; self.device = 'cuda:0'
    def detach(self): return self
    def float(self): return self
    def clone(self): return MockTensor()

received_kwargs = {}
def strict_apply_model(x, t, **c_kw):
    received_kwargs['x'] = x
    received_kwargs['t'] = t
    received_kwargs.update(c_kw)
    return MockTensor()

h3_envelope = {
    'input': MockTensor(),
    'timestep': 20.0,
    'c': {
        'cross_attention': 'mock_cross_attention',
        'latent_shapes': (1, 16, 20, 20),
        'minimax_payload': {'tokens': 512, 'audio_scale': 1.0}
    },
    'cond_or_uncond': [0]
}

out = wrapper(strict_apply_model, h3_envelope)
assert out is not None
assert received_kwargs['t'] == 20.0
assert received_kwargs['cross_attention'] == 'mock_cross_attention'
assert received_kwargs['latent_shapes'] == (1, 16, 20, 20)
assert received_kwargs['minimax_payload'] == {'tokens': 512, 'audio_scale': 1.0}
assert 'c' not in received_kwargs
assert 'cond_or_uncond' not in received_kwargs

sess.advance_step(1)
multi_cfg_envelope = {
    'input': MockTensor(),
    'timestep': 19.0,
    'c': {'cross_attention': 'mock'},
    'cond_or_uncond': [0, 1]
}
try:
    wrapper(strict_apply_model, multi_cfg_envelope)
    assert False, "Expected multi-branch CFG to be rejected"
except RuntimeError as e:
    assert "Multi-condition/CFG branching is unsupported" in str(e)

pkg.reset_active_session(tok)
sess.cleanup()
print("SUCCESS")
`;
      const res = runPythonTest(code);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("SUCCESS");
    });
  });
});
