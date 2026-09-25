"use client";

import React, { useState, useEffect, useRef } from "react";
import { REFERENCE_ROLES, type ReferenceAssetResponse, type ReferenceRole } from "@cco/contracts";
import { uploadClientReference, ApiClientError } from "../../api/client";

export interface ReferenceUploadModalProps {
  readonly clientId: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onUploadSuccess: (newReference: ReferenceAssetResponse) => void;
}

const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MiB

const ROLE_LABELS: Record<ReferenceRole, string> = {
  subject_identity: "Subject Identity",
  product: "Product",
  location: "Location",
  style: "Style",
  composition: "Composition"
};

export function ReferenceUploadModal({
  clientId,
  isOpen,
  onClose,
  onUploadSuccess
}: ReferenceUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [libraryRole, setLibraryRole] = useState<ReferenceRole>("subject_identity");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Helper to safely set and clean up object URLs
  const updatePreviewUrl = (url: string | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = url;
    setPreviewUrl(url);
  };

  // Revoke object URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  // Reset form when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      updatePreviewUrl(null);
      setFile(null);
      setDisplayName("");
      setLibraryRole("subject_identity");
      setError(null);
      setIsUploading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileSelection = (selectedFile: File | undefined) => {
    setError(null);
    if (!selectedFile) {
      setFile(null);
      updatePreviewUrl(null);
      return;
    }

    if (!SUPPORTED_TYPES.includes(selectedFile.type)) {
      setError("Unsupported format. Only PNG, JPEG, and WebP images are supported.");
      return;
    }

    if (selectedFile.size > MAX_BYTES) {
      setError("File exceeds 10 MiB limit.");
      return;
    }

    if (selectedFile.size === 0) {
      setError("File is empty.");
      return;
    }

    setFile(selectedFile);
    const objectUrl = URL.createObjectURL(selectedFile);
    updatePreviewUrl(objectUrl);

    if (!displayName) {
      // Auto-suggest name from filename without extension
      const baseName = selectedFile.name.replace(/\.[^/.]+$/, "");
      if (baseName.trim()) {
        setDisplayName(baseName.trim());
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select an image file to upload.");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const result = await uploadClientReference(clientId, {
        body: file,
        mimeType: file.type,
        displayName: displayName.trim() || undefined,
        libraryRole
      });

      updatePreviewUrl(null);
      onUploadSuccess(result);
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to upload reference image.";
      setError(message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      data-testid="reference-upload-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem"
      }}
    >
      <div
        style={{
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-prominent)",
          borderRadius: "var(--radius-lg)",
          width: "100%",
          maxWidth: "520px",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column"
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1.25rem",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <h2
            id="upload-modal-title"
            style={{ fontSize: "1.125rem", fontWeight: 600, color: "var(--text-primary)" }}
          >
            Upload Client Reference
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            aria-label="Close dialog"
            data-testid="upload-modal-close"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "1.25rem",
              padding: "0.25rem"
            }}
          >
            ✕
          </button>
        </div>

        {/* Content / Form */}
        <form
          onSubmit={handleSubmit}
          style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}
        >
          {error && (
            <div
              data-testid="upload-error-banner"
              style={{
                backgroundColor: "var(--status-failed-bg)",
                border: "1px solid var(--status-failed-border)",
                color: "var(--status-failed-text)",
                padding: "0.75rem",
                borderRadius: "var(--radius-sm)",
                fontSize: "0.875rem"
              }}
            >
              {error}
            </div>
          )}

          {/* File Picker / Dropzone */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: 500,
                marginBottom: "0.5rem"
              }}
            >
              Reference Image *
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const droppedFile = e.dataTransfer.files[0];
                handleFileSelection(droppedFile);
              }}
              data-testid="reference-dropzone"
              style={{
                border: "2px dashed var(--border-prominent)",
                borderRadius: "var(--radius-md)",
                padding: "1.5rem",
                textAlign: "center",
                cursor: "pointer",
                backgroundColor: "var(--bg-primary)",
                transition: "border-color 0.15s ease"
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: "none" }}
                data-testid="reference-file-input"
                onChange={(e) => handleFileSelection(e.target.files?.[0])}
              />

              {previewUrl ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "0.5rem"
                  }}
                >
                  <img
                    src={previewUrl}
                    alt="Preview"
                    data-testid="upload-image-preview"
                    style={{
                      maxHeight: "160px",
                      maxWidth: "100%",
                      objectFit: "contain",
                      borderRadius: "var(--radius-sm)"
                    }}
                  />
                  <span style={{ fontSize: "0.75rem", color: "var(--color-primary)" }}>
                    Click or drag to replace image
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "0.5rem"
                  }}
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span style={{ fontSize: "0.875rem", color: "var(--text-primary)" }}>
                    Choose an image or drag & drop here
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    PNG, JPEG, WebP up to 10 MiB
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Role Selection */}
          <div>
            <label
              htmlFor="upload-role-select"
              style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: 500,
                marginBottom: "0.5rem"
              }}
            >
              Intended Library Role *
            </label>
            <select
              id="upload-role-select"
              data-testid="upload-role-select"
              value={libraryRole}
              onChange={(e) => setLibraryRole(e.target.value as ReferenceRole)}
              disabled={isUploading}
              style={{
                width: "100%",
                padding: "0.625rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)",
                backgroundColor: "var(--bg-primary)",
                color: "var(--text-primary)",
                fontSize: "0.875rem"
              }}
            >
              {REFERENCE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                display: "block",
                marginTop: "0.25rem"
              }}
            >
              Default classification for library organization; specific scene roles are assigned
              during planning.
            </span>
          </div>

          {/* Display Name */}
          <div>
            <label
              htmlFor="upload-display-name"
              style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: 500,
                marginBottom: "0.5rem"
              }}
            >
              Display Name (Optional)
            </label>
            <input
              id="upload-display-name"
              type="text"
              data-testid="upload-display-name-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={isUploading}
              placeholder="e.g. Hero Character Front View"
              style={{
                width: "100%",
                padding: "0.625rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)",
                backgroundColor: "var(--bg-primary)",
                color: "var(--text-primary)",
                fontSize: "0.875rem"
              }}
            />
          </div>

          {/* Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.75rem",
              marginTop: "0.5rem",
              paddingTop: "1rem",
              borderTop: "1px solid var(--border-subtle)"
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              data-testid="upload-cancel-button"
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-prominent)",
                backgroundColor: "transparent",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "0.875rem"
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading || !file}
              data-testid="upload-submit-button"
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "var(--radius-sm)",
                border: "none",
                backgroundColor:
                  isUploading || !file ? "var(--border-prominent)" : "var(--color-primary)",
                color: isUploading || !file ? "var(--text-muted)" : "#0f172a",
                fontWeight: 600,
                cursor: isUploading || !file ? "not-allowed" : "pointer",
                fontSize: "0.875rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem"
              }}
            >
              {isUploading ? "Uploading..." : "Upload Reference"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
