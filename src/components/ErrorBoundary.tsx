import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { getStoredLanguage } from '../i18n/LanguageContext';
import { TRANSLATIONS } from '../i18n/translations';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const t = TRANSLATIONS[getStoredLanguage()];
    return {
      hasError: true,
      message: error?.message || t.errorBoundary.unexpectedError,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const t = TRANSLATIONS[getStoredLanguage()];

    let parsedFirestore: { error?: string; operationType?: string; path?: string } | null = null;
    try {
      const candidate = JSON.parse(this.state.message);
      if (candidate && typeof candidate === 'object' && 'operationType' in candidate) {
        parsedFirestore = candidate;
      }
    } catch {
      // non-JSON error
    }

    return (
      <div className="min-h-screen bg-[#f7f7f6] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2.5 text-red-700">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h1 className="text-base font-semibold text-zinc-900">
              {t.errorBoundary.title}
            </h1>
          </div>
          <p className="text-xs text-zinc-600 leading-relaxed">
            {parsedFirestore
              ? t.errorBoundary.firestoreError(parsedFirestore.operationType, parsedFirestore.path)
              : this.state.message}
          </p>
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-zinc-900 rounded-md hover:bg-zinc-800"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t.errorBoundary.reload}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
