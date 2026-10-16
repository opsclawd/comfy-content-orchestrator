#!/usr/bin/env python3
"""
MiniMax-H3 Package Artifact Inspector
Computes and verifies installed-package RECORD artifact build identity (installed_record_sha256_v1).
Fail-closed on missing __file__, missing/empty RECORD, unreadable payload, import shadowing, or hash mismatch.
"""

import sys
import os
import csv
import io
import json
import base64
import hashlib
import importlib
import importlib.metadata

def inspect_package(dist_name: str, expected_ver: str | None, import_mod: str, expected_hash: str | None, expected_method: str | None = None):
    # 1. Import module
    try:
        mod = importlib.import_module(import_mod)
    except Exception as e:
        print(f"import_error:cannot_import_{import_mod}:{e}")
        sys.exit(1)

    # 2. Check __file__ attribute (fail closed if missing or None)
    mod_file = getattr(mod, "__file__", None)
    if not mod_file:
        print(f"missing_file_attribute:module_{import_mod}_lacks___file___attribute")
        sys.exit(1)

    # 3. Check expected_hash and expected_method (fail closed if missing/empty unless measurement mode)
    if expected_hash != "__MEASURE__" and (not expected_hash or not expected_hash.strip()):
        print(f"missing_expected_hash:distribution_{dist_name}_requires_expected_artifact_hash")
        sys.exit(1)

    if expected_hash != "__MEASURE__":
        if not expected_method or not expected_method.strip() or expected_method.strip() != "installed_record_sha256_v1":
            print(f"unsupported_artifact_method:distribution_{dist_name}_requires_installed_record_sha256_v1_got_{expected_method}")
            sys.exit(1)
    else:
        if expected_method and expected_method.strip() and expected_method.strip() != "installed_record_sha256_v1":
            print(f"unsupported_artifact_method:distribution_{dist_name}_requires_installed_record_sha256_v1_got_{expected_method}")
            sys.exit(1)

    # 4. Distribution metadata
    try:
        dist = importlib.metadata.distribution(dist_name)
    except Exception as e:
        print(f"metadata_error:distribution_{dist_name}_not_found:{e}")
        sys.exit(1)

    installed_ver = dist.version
    if expected_ver and installed_ver != expected_ver:
        print(f"version_mismatch:expected_{expected_ver}_got_{installed_ver}")
        sys.exit(1)

    # Check for unsupported editable/direct_url installs
    try:
        direct_url_text = dist.read_text("direct_url.json")
        if direct_url_text:
            try:
                du_data = json.loads(direct_url_text)
                if du_data.get("dir_info", {}).get("editable", False):
                    print(f"unsupported_editable_install:distribution_{dist_name}_is_editable_install")
                    sys.exit(1)
            except Exception:
                pass
    except Exception:
        pass

    # 5. Check RECORD
    try:
        record_text = dist.read_text("RECORD")
    except Exception as e:
        print(f"record_error:failed_to_read_RECORD_for_{dist_name}:{e}")
        sys.exit(1)

    if record_text is None:
        print(f"missing_record:distribution_{dist_name}_has_no_RECORD")
        sys.exit(1)

    if not record_text.strip():
        print(f"empty_record:distribution_{dist_name}_has_empty_RECORD")
        sys.exit(1)

    # 5. Parse RECORD and compute actual file SHA-256 for all non-installation-generated files
    reader = csv.reader(io.StringIO(record_text))
    valid_files = []
    audited_abs_paths = set()
    mod_file_real = os.path.realpath(mod_file)

    for row in reader:
        if not row or len(row) < 1:
            continue
        rel_path = row[0].strip()
        if not rel_path:
            continue
        norm_rel = rel_path.replace("\\", "/")

        # Exclude only documented installation-generated files:
        # Bytecode (.pyc) and RECORD's self-hash
        if norm_rel.endswith(".pyc") or "/__pycache__/" in norm_rel or norm_rel.endswith(".dist-info/RECORD"):
            continue

        try:
            located = dist.locate_file(rel_path)
            abs_path = os.path.realpath(str(located))
        except Exception as e:
            print(f"file_locate_error:{norm_rel}:{e}")
            sys.exit(1)

        if not os.path.exists(abs_path):
            print(f"missing_payload_file:{norm_rel}")
            sys.exit(1)
        if not os.path.isfile(abs_path):
            print(f"invalid_payload_file:{norm_rel}")
            sys.exit(1)

        audited_abs_paths.add(abs_path)

        h = hashlib.sha256()
        try:
            with open(abs_path, "rb") as f:
                while chunk := f.read(65536):
                    h.update(chunk)
        except Exception as e:
            print(f"file_read_error:{norm_rel}:{e}")
            sys.exit(1)

        file_digest = h.digest()
        file_sha256 = h.hexdigest()

        # Validate against RECORD hash (mandatory for all payload files)
        if len(row) < 2 or not row[1] or not row[1].strip():
            print(f"missing_record_hash_declaration:file_{norm_rel}_lacks_record_hash")
            sys.exit(1)
        hash_decl = row[1].strip()
        if not hash_decl.startswith("sha256="):
            print(f"unsupported_record_hash_algorithm:{hash_decl}")
            sys.exit(1)
        expected_b64 = hash_decl[7:]
        if not expected_b64:
            print(f"missing_record_hash_declaration:file_{norm_rel}_has_empty_record_hash")
            sys.exit(1)
        actual_b64 = base64.urlsafe_b64encode(file_digest).decode("utf-8").rstrip("=")
        if actual_b64 != expected_b64:
            print(f"record_hash_mismatch:file_{norm_rel}_hash_mismatch")
            sys.exit(1)

        # Validate RECORD file size if declared
        if len(row) >= 3 and row[2] and row[2].strip():
            try:
                expected_size = int(row[2].strip())
                actual_size = os.path.getsize(abs_path)
                if actual_size != expected_size:
                    print(f"record_size_mismatch:file_{norm_rel}_size_mismatch:expected_{expected_size}_got_{actual_size}")
                    sys.exit(1)
            except ValueError:
                print(f"invalid_record_size:file_{norm_rel}_invalid_size_{row[2]}")
                sys.exit(1)

        valid_files.append((norm_rel, file_sha256))

    if len(valid_files) == 0:
        print(f"empty_record:distribution_{dist_name}_has_no_valid_payload_files")
        sys.exit(1)

    if mod_file_real not in audited_abs_paths:
        print(f"import_shadowing:module_{import_mod}_resolved_outside_{dist_name}_distribution")
        sys.exit(1)

    # Sort files deterministically by normalized relative path
    valid_files.sort(key=lambda x: x[0])

    payload = {
        "files": [{"path": p, "sha256": s} for p, s in valid_files],
        "method": "installed_record_sha256_v1",
        "name": dist_name,
        "version": installed_ver
    }
    payload_canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    installed_build_digest = hashlib.sha256(payload_canonical.encode("utf-8")).hexdigest()

    if expected_hash and expected_hash != "__MEASURE__" and installed_build_digest != expected_hash:
        print(f"hash_mismatch:expected_{expected_hash}_got_{installed_build_digest}")
        sys.exit(1)

    result = {
        "ok": True,
        "name": dist_name,
        "version": installed_ver,
        "artifactHash": installed_build_digest,
        "artifactMethod": "installed_record_sha256_v1",
        "fileCount": len(valid_files)
    }
    print("ok:" + json.dumps(result, separators=(",", ":")))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: minimax-h3-package-inspector.py <dist_name> [expected_ver] [import_mod] [expected_hash] [expected_method]")
        sys.exit(1)
    d_name = sys.argv[1]
    e_ver = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
    i_mod = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else d_name.replace("-", "_")
    e_hash = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None
    e_method = sys.argv[5].strip() if len(sys.argv) > 5 and sys.argv[5].strip() else None
    inspect_package(d_name, e_ver, i_mod, e_hash, e_method)
