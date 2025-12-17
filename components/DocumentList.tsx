"use client";

import { useState, useEffect } from "react";

interface DocumentListProps {
  refreshTrigger?: number;
}

export default function DocumentList({ refreshTrigger }: DocumentListProps) {
  const [documents, setDocuments] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingDoc, setDeletingDoc] = useState<string | null>(null);

  const fetchDocuments = async () => {
    try {
      const response = await fetch("/api/documents");
      const data = await response.json();
      if (data.success) {
        setDocuments(data.documents);
      }
    } catch (error) {
      console.error("Failed to fetch documents:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [refreshTrigger]);

  const handleDelete = async (documentName: string) => {
    if (!confirm(`Are you sure you want to delete "${documentName}"?`)) {
      return;
    }

    setDeletingDoc(documentName);
    try {
      const response = await fetch(
        `/api/documents?name=${encodeURIComponent(documentName)}`,
        { method: "DELETE" }
      );
      const data = await response.json();
      if (data.success) {
        setDocuments((prev) => prev.filter((d) => d !== documentName));
      }
    } catch (error) {
      console.error("Failed to delete document:", error);
    } finally {
      setDeletingDoc(null);
    }
  };

  if (isLoading) {
    return (
      <div className="text-gray-500 text-sm">Loading documents...</div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="text-gray-400 text-sm italic">
        No documents uploaded yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700">
        Uploaded Documents ({documents.length})
      </h3>
      <ul className="space-y-1">
        {documents.map((doc) => (
          <li
            key={doc}
            className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
          >
            <div className="flex items-center space-x-2 min-w-0">
              <svg
                className="w-4 h-4 text-red-500 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm text-gray-600 truncate">{doc}</span>
            </div>
            <button
              onClick={() => handleDelete(doc)}
              disabled={deletingDoc === doc}
              className="p-1 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
              title="Delete document"
            >
              {deletingDoc === doc ? (
                <svg
                  className="w-4 h-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
