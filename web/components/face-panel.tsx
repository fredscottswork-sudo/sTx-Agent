"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceResult, ReportPayload } from "@/lib/types";
import { Card } from "./common";

type Faceapi = typeof import("@vladmandic/face-api");

const MODELS_URL = "/models";

let loader: Promise<Faceapi> | null = null;

async function loadModels(): Promise<Faceapi> {
  if (!loader) {
    loader = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      const tf = faceapi.tf as unknown as { ready?: () => Promise<unknown> };
      if (typeof tf.ready === "function") await tf.ready();
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL);
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL);
      await faceapi.nets.ageGenderNet.loadFromUri(MODELS_URL);
      await faceapi.nets.faceExpressionNet.loadFromUri(MODELS_URL);
      return faceapi;
    })();
    loader.catch(() => {
      loader = null;
    });
  }
  return loader;
}

function verdictFrom(distance: number, mode: "fast" | "accurate"): FaceResult {
  const score = Math.round(Math.max(0, Math.min(1, (0.9 - distance) / 0.6)) * 100);
  const caveat =
    "Results depend on photo quality — angle, lighting, expression, age gap and occlusion all shift the score. Treat this as one signal among many, never as proof of identity.";
  const modeNote = mode === "accurate" ? " (SSD-accurate pass)" : " (fast pass)";
  if (distance <= 0.45) {
    return {
      distance,
      similarity: score,
      verdict: "match",
      mode,
      verdictLabel: "MATCH — descriptors within the high-confidence band",
      explanation: `Euclidean distance ${distance.toFixed(3)}${modeNote} is inside the range normally seen when both photos show the same person (≤ 0.45). ${caveat}`,
    };
  }
  if (distance <= 0.6) {
    return {
      distance,
      similarity: score,
      verdict: "likely",
      mode,
      verdictLabel: "LIKELY MATCH — same person, moderate confidence",
      explanation: `Distance ${distance.toFixed(3)}${modeNote} sits in the probable-same-person band (0.45–0.60). Differences may come from pose, lighting or time between photos. ${caveat}`,
    };
  }
  if (distance <= 0.75) {
    return {
      distance,
      similarity: score,
      verdict: "uncertain",
      mode,
      verdictLabel: "UNCERTAIN — borderline, inconclusive",
      explanation: `Distance ${distance.toFixed(3)}${modeNote} is borderline (0.60–0.75): the faces share some similarity but not enough to call. Re-run with clearer, frontal, similarly-lit photos. ${caveat}`,
    };
  }
  return {
    distance,
    similarity: score,
    verdict: "different",
    mode,
    verdictLabel: "DIFFERENT — descriptors are far apart",
    explanation: `Distance ${distance.toFixed(3)}${modeNote} exceeds 0.75, the range typical of two different people. ${caveat}`,
  };
}

interface Slot {
  file: File | null;
  url: string | null;
}

interface Analysis {
  image: HTMLImageElement;
  count: number;
  box: { x: number; y: number; width: number; height: number };
  descriptor: Float32Array;
  landmarks: { x: number; y: number }[];
  age: number | null;
  gender: string | null;
  expression: string | null;
  expressionProb: number | null;
  brightness: number;
  sizePct: number;
}

function analyzeDescriptor(
  faceapi: Faceapi,
  img: HTMLImageElement,
  opts: { inputSize: number; scoreThreshold: number },
): Promise<Analysis> {
  return (async () => {
    const detOpts =
      opts.inputSize === 512
        ? new faceapi.SsdMobilenetv1Options({ minConfidence: opts.scoreThreshold })
        : new faceapi.TinyFaceDetectorOptions({
            inputSize: opts.inputSize as 128 | 160 | 224 | 320 | 416 | 512,
            scoreThreshold: opts.scoreThreshold,
          });

    const dets = await faceapi
      .detectAllFaces(img, detOpts)
      .withFaceLandmarks()
      .withFaceDescriptors()
      .withAgeAndGender()
      .withFaceExpressions();
    if (!dets.length) throw new Error("NO_FACE");

    // pick largest face
    let bestIdx = 0;
    let bestArea = -1;
    dets.forEach((d, i) => {
      const a = d.detection.box.width * d.detection.box.height;
      if (a > bestArea) {
        bestArea = a;
        bestIdx = i;
      }
    });
    const primary = dets[bestIdx];
    const dominant = primary.expressions.asSortedArray()[0] ?? null;

    const box = primary.detection.box;
    const sizePct = Math.round(
      ((box.width * box.height) / (img.naturalWidth * img.naturalHeight)) * 100,
    );

    // brightness of face region
    let brightness = 128;
    try {
      const c = document.createElement("canvas");
      const w = Math.max(1, Math.min(64, Math.round(box.width)));
      const h = Math.max(1, Math.min(64, Math.round(box.height)));
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        brightness = Math.round(sum / (data.length / 4));
      }
    } catch {
      /* canvas may taint on exotic formats */
    }

    return {
      image: img,
      count: dets.length,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      descriptor: primary.descriptor,
      landmarks: primary.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
      age: typeof primary.age === "number" ? primary.age : null,
      gender: primary.gender ?? null,
      expression: dominant?.expression ?? null,
      expressionProb: dominant?.probability ?? null,
      brightness,
      sizePct,
    };
  })();
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
      await loadModels();
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
      const faceapi = await loadModels();
      setModelsReady(true);
      setPhase("running");

      const opts =
        mode === "accurate"
          ? { inputSize: 512, scoreThreshold: 0.5 }
          : { inputSize: 416, scoreThreshold: 0.4 };

      async function analyze(file: File, which: string): Promise<Analysis> {
        const img = await faceapi.bufferToImage(file);
        try {
          return await analyzeDescriptor(faceapi, img, opts);
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
