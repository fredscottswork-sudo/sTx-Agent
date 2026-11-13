"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceResult, ReportPayload } from "@/lib/types";
import { Card } from "./common";
import { analyzeFace, loadFaceModels, verdictFrom, type FaceAnalysis, type Faceapi } from "@/lib/face";

type Analysis = FaceAnalysis;

interface Slot {
  file: File | null;
  url: string | null;
}

function DrawCanvas({ analysis, label }: { analysis: Analysis; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const img = analysis.image;
    const maxW = 480;
    const scale = Math.min(1, maxW / img.naturalWidth);
    cv.width = Math.round(img.naturalWidth * scale);
    cv.height = Math.round(img.naturalHeight * scale);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const b = analysis.box;
    ctx.strokeStyle = "#22e0a1";
    ctx.lineWidth = Math.max(2, cv.width / 300);
    ctx.strokeRect(b.x * scale, b.y * scale, b.width * scale, b.height * scale);
    ctx.fillStyle = "rgba(5,10,14,0.85)";
    ctx.fillRect(b.x * scale, b.y * scale - 18, 64, 16);
    ctx.fillStyle = "#22e0a1";
    ctx.font = "11px monospace";
    ctx.fillText(label, b.x * scale + 4, b.y * scale - 5);
    ctx.fillStyle = "#4cc2ff";
    const r = Math.max(1.2, cv.width / 400);
    for (const p of analysis.landmarks) {
      ctx.beginPath();
      ctx.arc(p.x * scale, p.y * scale, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [analysis, label]);
  return <canvas ref={ref} className="face-canvas" />;
}

export function FacePanel({
  onCollect,
}: {
  onCollect: (patch: Partial<ReportPayload>) => void;
}) {
  const [a, setA] = useState<Slot>({ file: null, url: null });
  const [b, setB] = useState<Slot>({ file: null, url: null });
  const [mode, setMode] = useState<"fast" | "accurate">("accurate");
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<"idle" | "loading" | "running" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FaceResult | null>(null);
  const [anaA, setAnaA] = useState<Analysis | null>(null);
  const [anaB, setAnaB] = useState<Analysis | null>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  function setSlot(slot: "a" | "b", f: File | null) {
    const setter = slot === "a" ? setA : setB;
    setter((prev) => {
      if (prev.url) URL.revokeObjectURL(prev.url);
      return { file: f, url: f ? URL.createObjectURL(f) : null };
    });
    setResult(null);
    setAnaA(null);
    setAnaB(null);
    setPhase("idle");
    setError(null);
  }

  useEffect(() => {
    return () => {
      if (a.url) URL.revokeObjectURL(a.url);
      if (b.url) URL.revokeObjectURL(b.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function preload() {
    setError(null);
    setPhase("loading");
    try {
      await loadFaceModels();
      setModelsReady(true);
      setPhase("idle");
    } catch (e) {
      setError(`Failed to load AI models: ${e instanceof Error ? e.message : "unknown error"}.`);
      setPhase("idle");
    }
  }

  async function run() {
    if (!a.file || !b.file || !consent || phase === "loading" || phase === "running") return;
    setError(null);
    setResult(null);
    setAnaA(null);
    setAnaB(null);
    setPhase("loading");
    const t0 = Date.now();
    try {
      const faceapi = await loadFaceModels();
      setModelsReady(true);
      setPhase("running");

      const opts =
        mode === "accurate"
          ? { inputSize: 512, scoreThreshold: 0.5 }
          : { inputSize: 416, scoreThreshold: 0.4 };

      async function analyze(file: File, which: string): Promise<Analysis> {
        const img = await faceapi.bufferToImage(file);
        try {
          return await analyzeFace(faceapi, img, opts, true);
        } catch (e) {
          if (e instanceof Error && e.message === "NO_FACE") {
            throw new Error(
              `No face detected in image ${which}. Use a sharp, well-lit photo where one face fills a good part of the frame — or switch detector mode.`,
            );
          }
          throw e;
        }
      }

      const [analysisA, analysisB] = await Promise.all([analyze(a.file, "A"), analyze(b.file, "B")]);
      const distance = faceapi.euclideanDistance(analysisA.descriptor, analysisB.descriptor);
      const vr = verdictFrom(distance, mode);
      vr.faceCountA = analysisA.count;
      vr.faceCountB = analysisB.count;
      vr.age = analysisA.age != null ? `${Math.round(analysisA.age)} yrs (±5)` : undefined;
      vr.gender = analysisA.gender ?? undefined;
      vr.expression = analysisA.expression
        ? `${analysisA.expression}${analysisA.expressionProb != null ? ` ${(analysisA.expressionProb * 100).toFixed(0)}%` : ""}`
        : undefined;

      setAnaA(analysisA);
      setAnaB(analysisB);
      setResult(vr);
      setElapsed((Date.now() - t0) / 1000);
      setPhase("done");
      onCollect({ face: vr });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Face comparison failed.");
      setPhase("idle");
    }
  }

  const busy = phase === "loading" || phase === "running";

  return (
    <Card
      title="AI face verification (1:1)"
      ico="▣"
      hint="Confirms whether two photos show the same person using deep face-recognition models running entirely in your browser. Choose Fast (tiny detector) or Accurate (SSD MobileNet). Includes age/gender/expression read-outs, face counting and landmark overlays. Verification between images you supply — never identification of strangers."
      right={
        <span className={`pill ${modelsReady ? "good" : "dim"}`}>
          {modelsReady ? "models loaded" : "models on demand"}
        </span>
      }
    >
      <div className="face-grid">
        <Dropzone label="Photo A" slot={a} onFile={(f) => setSlot("a", f)} />
        <Dropzone label="Photo B" slot={b} onFile={(f) => setSlot("b", f)} />
      </div>

      <div className="face-controls">
        <div className="mode-toggle" role="radiogroup" aria-label="Detector mode">
          <button
            className={`mode-btn ${mode === "fast" ? "on" : ""}`}
            onClick={() => setMode("fast")}
            disabled={busy}
            title="TinyFaceDetector — quicker, slightly less precise"
          >
            ⚡ Fast
          </button>
          <button
            className={`mode-btn ${mode === "accurate" ? "on" : ""}`}
            onClick={() => setMode("accurate")}
            disabled={busy}
            title="SSD MobileNet — slower, higher detection accuracy"
          >
            🎯 Accurate
          </button>
        </div>
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            I confirm I have the right to compare these images — they are mine, or I have explicit
            permission from the people shown.
          </span>
        </label>
        <button className="btn btn-ghost btn-sm" onClick={preload} disabled={busy || modelsReady}>
          {modelsReady ? "Models ready ✓" : "Preload models"}
        </button>
        <button
          className="btn btn-primary"
          onClick={run}
          disabled={!a.file || !b.file || !consent || busy}
        >
          {phase === "loading"
            ? "Loading AI models…"
            : phase === "running"
              ? "Comparing faces…"
              : "Verify match"}
        </button>
      </div>

      <div className="privacy-note">
        <b>Privacy:</b> photos never leave your device — detection, descriptors and attribute estimation
        run locally via TensorFlow.js; only the numeric result is stored for the report. Models load
        once from <span className="mono">/models</span> (~13 MB total, cached by your browser).
      </div>

      <ErrorBoxLocal error={error} />

      {(anaA || anaB) && (
        <div className="face-grid mt14">
          {anaA && (
            <div className="face-analysis">
              <DrawCanvas analysis={anaA} label={`A · ${anaA.count} face${anaA.count > 1 ? "s" : ""}`} />
              <FaceStats analysis={anaA} />
            </div>
          )}
          {anaB && (
            <div className="face-analysis">
              <DrawCanvas analysis={anaB} label={`B · ${anaB.count} face${anaB.count > 1 ? "s" : ""}`} />
              <FaceStats analysis={anaB} />
            </div>
          )}
        </div>
      )}

      {result && phase === "done" && (
        <div className={`verdict-box ${result.verdict}`}>
          <div className="verdict-head">
            <span className="verdict-label">{result.verdictLabel}</span>
            <span className="verdict-score">{result.similarity}%</span>
          </div>
          <div className="gauge">
            <div className="gauge-fill" style={{ width: `${result.similarity}%` }} />
          </div>
          <p className="verdict-expl">{result.explanation}</p>
          <div className="verdict-meta">
            <span>distance: {result.distance.toFixed(4)}</span>
            <span>{result.mode === "accurate" ? "SSD accurate" : "tiny fast"} detector</span>
            {result.faceCountA != null && <span>faces A/B: {result.faceCountA}/{result.faceCountB}</span>}
            <span>bands: ≤0.45 match · ≤0.60 likely · ≤0.75 uncertain · &gt;0.75 different</span>
            <span>{elapsed.toFixed(2)}s</span>
          </div>
          {(result.faceCountA! > 1 || result.faceCountB! > 1) && (
            <p className="small muted mt8">
              Multiple faces detected — the largest face in each photo was compared. Crop tighter for a
              cleaner result.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function FaceStats({ analysis }: { analysis: Analysis }) {
  const quality =
    analysis.brightness < 60
      ? "too dark"
      : analysis.brightness > 210
        ? "overexposed"
        : analysis.sizePct < 4
          ? "face too small"
        : analysis.brightness < 90 || analysis.brightness > 185
          ? "marginal lighting"
          : "good";
  return (
    <div className="face-stats">
      {analysis.age != null && <span className="pill info">age ≈ {Math.round(analysis.age)} ±5</span>}
      {analysis.gender && <span className="pill info">{analysis.gender}</span>}
      {analysis.expression && (
        <span className="pill info">
          {analysis.expression}
          {analysis.expressionProb != null ? ` ${(analysis.expressionProb * 100).toFixed(0)}%` : ""}
        </span>
      )}
      <span className={`pill ${quality === "good" ? "good" : "warn"}`}>light: {quality}</span>
      <span className="pill dim">face {analysis.sizePct}% of frame</span>
      {analysis.count > 1 && <span className="pill warn">{analysis.count} faces — using largest</span>}
    </div>
  );
}

function Dropzone({
  label,
  slot,
  onFile,
}: {
  label: string;
  slot: Slot;
  onFile: (f: File | null) => void;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function accept(files: FileList | null) {
    const f = files?.[0];
    if (f && f.type.startsWith("image/")) onFile(f);
  }

  return (
    <div
      className={`dropzone ${drag ? "drag" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        accept(e.dataTransfer.files);
      }}
    >
      <span className="dz-badge">{label}</span>
      {slot.url ? (
        <img src={slot.url} alt={`${label} preview`} />
      ) : (
        <>
          <div className="dz-title">Drop photo or click</div>
          <div className="dz-hint">JPG / PNG / WEBP · clear, frontal face works best</div>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          accept(e.target.files);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}

function ErrorBoxLocal({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error-box">⚠ {error}</div>;
}
