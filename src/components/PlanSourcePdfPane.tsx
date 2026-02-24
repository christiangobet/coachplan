'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type PlanSourcePdfPaneProps = {
  fileUrl: string;
  initialPageCount?: number | null;
};

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.2;
const DEFAULT_ZOOM = 1.2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatZoom(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default function PlanSourcePdfPane({
  fileUrl,
  initialPageCount
}: PlanSourcePdfPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const textLayerTaskRef = useRef<any>(null);

  const [loadingDoc, setLoadingDoc] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(initialPageCount || 0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  const updateZoom = useCallback((nextZoom: number) => {
    setZoom(clamp(Number(nextZoom.toFixed(2)), MIN_ZOOM, MAX_ZOOM));
  }, []);

  const jumpToPage = useCallback((raw: string) => {
    if (!pageCount) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(pageNumber));
      return;
    }
    const nextPage = clamp(Math.round(parsed), 1, pageCount);
    setPageNumber(nextPage);
    setPageInput(String(nextPage));
  }, [pageCount, pageNumber]);

  const fitWidth = useCallback(async () => {
    const doc = pdfRef.current;
    const container = containerRef.current;
    if (!doc || !container) return;
    try {
      const page = await doc.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      if (!baseViewport?.width) return;
      const targetWidth = Math.max(200, container.clientWidth - 24);
      updateZoom(targetWidth / baseViewport.width);
    } catch {
      // noop: keep current zoom if fit-width cannot be computed.
    }
  }, [pageNumber, updateZoom]);

  useEffect(() => {
    let cancelled = false;

    async function loadDocument() {
      setLoadingDoc(true);
      setError(null);
      setPageInput('1');
      setPageNumber(1);
      setZoom(DEFAULT_ZOOM);
      setPageCount(initialPageCount || 0);

      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* noop */ }
        renderTaskRef.current = null;
      }
      if (textLayerTaskRef.current) {
        try { textLayerTaskRef.current.cancel(); } catch { /* noop */ }
        textLayerTaskRef.current = null;
      }
      if (pdfRef.current) {
        try {
          await pdfRef.current.destroy();
        } catch {
          // noop
        }
        pdfRef.current = null;
      }

      try {
        const [pdfjs, response] = await Promise.all([
          import('pdfjs-dist/legacy/build/pdf.mjs'),
          fetch(fileUrl, { cache: 'no-store' })
        ]);
        if (!response.ok) {
          throw new Error('Unable to load source PDF.');
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const workerSrc = '/api/pdfjs/worker';
        if (pdfjs.GlobalWorkerOptions?.workerSrc !== workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        }
        const loadingTask = pdfjs.getDocument({ data: bytes } as any);
        const pdf = await loadingTask.promise;
        if (cancelled) {
          try {
            await pdf.destroy();
          } catch {
            // noop
          }
          return;
        }
        pdfRef.current = pdf;
        const totalPages = Number(pdf.numPages) || 0;
        setPageCount(totalPages);
        setPageNumber(1);
        setPageInput('1');
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load PDF.');
      } finally {
        if (!cancelled) {
          setLoadingDoc(false);
        }
      }
    }

    void loadDocument();

    return () => {
      cancelled = true;
    };
  }, [fileUrl, initialPageCount]);

  useEffect(() => {
    setPageInput(String(pageNumber));
  }, [pageNumber]);

  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      const pdf = pdfRef.current;
      const canvas = canvasRef.current;
      if (!pdf || !canvas || !pageCount || pageNumber < 1 || pageNumber > pageCount) return;

      setLoadingPage(true);
      setError(null);

      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* noop */ }
        renderTaskRef.current = null;
      }
      if (textLayerTaskRef.current) {
        try { textLayerTaskRef.current.cancel(); } catch { /* noop */ }
        textLayerTaskRef.current = null;
      }

      try {
        const [pdfjs, page] = await Promise.all([
          import('pdfjs-dist/legacy/build/pdf.mjs') as any,
          pdf.getPage(pageNumber)
        ]);
        const cssViewport = page.getViewport({ scale: zoom });
        const outputScale = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
        const renderViewport = page.getViewport({ scale: zoom * outputScale });
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) {
          throw new Error('Canvas context is not available.');
        }

        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));
        canvas.style.width = `${Math.max(1, Math.floor(cssViewport.width))}px`;
        canvas.style.height = `${Math.max(1, Math.floor(cssViewport.height))}px`;

        const task = page.render({
          canvasContext: context,
          viewport: renderViewport
        } as any);
        renderTaskRef.current = task;
        await task.promise;
        renderTaskRef.current = null;

        // Text layer — render invisible selectable text over the canvas
        const textLayerDiv = textLayerRef.current;
        if (textLayerDiv && pdfjs.TextLayer && !cancelled) {
          textLayerDiv.replaceChildren();
          // --scale-factor is required by pdfjs TextLayer's setLayerDimensions() to size the container
          textLayerDiv.style.setProperty('--scale-factor', String(zoom));
          const tlTask = new pdfjs.TextLayer({
            textContentSource: page.streamTextContent(),
            container: textLayerDiv,
            viewport: cssViewport
          });
          textLayerTaskRef.current = tlTask;
          await tlTask.render();
          textLayerTaskRef.current = null;
        }
      } catch (renderError: any) {
        if (cancelled) return;
        const cancelledRender = typeof renderError?.message === 'string'
          && renderError.message.toLowerCase().includes('cancel');
        if (!cancelledRender) {
          setError(renderError instanceof Error ? renderError.message : 'Failed to render page.');
        }
      } finally {
        if (!cancelled) {
          setLoadingPage(false);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
    };
  }, [pageCount, pageNumber, zoom]);

  return (
    <div className="review-pdf-pane">
      <div className="review-pdf-toolbar">
        <div className="review-pdf-toolbar-group">
          <button
            type="button"
            className="review-save-btn secondary"
            onClick={() => setPageNumber((prev) => Math.max(1, prev - 1))}
            disabled={loadingDoc || pageNumber <= 1}
          >
            Prev
          </button>
          <label className="review-pdf-page-input">
            <input
              type="text"
              inputMode="numeric"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={() => jumpToPage(pageInput)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  jumpToPage(pageInput);
                }
              }}
              disabled={loadingDoc || pageCount === 0}
            />
            <span>/ {pageCount || '—'}</span>
          </label>
          <button
            type="button"
            className="review-save-btn secondary"
            onClick={() => setPageNumber((prev) => Math.min(pageCount || 1, prev + 1))}
            disabled={loadingDoc || pageCount === 0 || pageNumber >= pageCount}
          >
            Next
          </button>
        </div>
        <div className="review-pdf-toolbar-group">
          <button
            type="button"
            className="review-save-btn secondary"
            onClick={() => updateZoom(zoom - ZOOM_STEP)}
            disabled={loadingDoc}
          >
            -
          </button>
          <span className="review-pdf-zoom-label">{formatZoom(zoom)}</span>
          <button
            type="button"
            className="review-save-btn secondary"
            onClick={() => updateZoom(zoom + ZOOM_STEP)}
            disabled={loadingDoc}
          >
            +
          </button>
          <button
            type="button"
            className="review-save-btn secondary"
            onClick={() => updateZoom(DEFAULT_ZOOM)}
            disabled={loadingDoc}
          >
            Reset
          </button>
          <button
            type="button"
            className="review-save-btn secondary"
            onClick={() => void fitWidth()}
            disabled={loadingDoc}
          >
            Fit width
          </button>
        </div>
      </div>

      <div className="review-pdf-canvas-wrap" ref={containerRef}>
        {loadingDoc && <p className="review-muted">Loading source PDF…</p>}
        {!loadingDoc && error && <p className="review-error">{error}</p>}
        {!loadingDoc && !error && (
          <div className="review-pdf-canvas-stage">
            <canvas ref={canvasRef} className="review-pdf-canvas" />
            <div ref={textLayerRef} className="textLayer" />
            {loadingPage && (
              <div className="review-pdf-overlay">
                <span>Rendering…</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
