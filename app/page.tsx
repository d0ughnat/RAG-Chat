"use client";

import { useState } from "react";
import PDFUploader from "@/components/PDFUploader";
import ChatInterface from "@/components/ChatInterface";
import DocumentList from "@/components/DocumentList";

export default function Home() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleUploadSuccess = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            📄 RAG Chat
          </h1>
          <p className="text-gray-600">
            Upload PDFs and chat with your documents using Google Gemini AI
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Upload Section */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">
                Upload PDF
              </h2>
              <PDFUploader onUploadSuccess={handleUploadSuccess} />
            </div>

            {/* Documents Section */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <DocumentList refreshTrigger={refreshTrigger} />
            </div>

            {/* Info Section */}
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <h3 className="text-sm font-semibold text-blue-800 mb-2">
                How it works
              </h3>
              <ol className="text-sm text-black space-y-1 list-decimal list-inside">
                <li>Upload a PDF document</li>
                <li>The system extracts and indexes the content</li>
                <li>Ask questions about your documents</li>
                <li>Get AI-powered answers with source references</li>
              </ol>
            </div>
          </div>

          {/* Chat Section */}
          <div className="lg:col-span-2">
            <ChatInterface />
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-8 text-center text-sm text-gray-500">
          <p>
            Powered by{" "}
            <span className="font-semibold">Google Gemini</span>,{" "}
            <span className="font-semibold">LangChain</span>, and{" "}
            <span className="font-semibold">Supabase</span>
          </p>
        </footer>
      </div>
    </main>
  );
}
