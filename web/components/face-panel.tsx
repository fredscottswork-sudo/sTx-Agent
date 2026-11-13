"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceResult, ReportPayload } from "@/lib/types";
import { Card } from "./panels";

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
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL);
      return faceapi;
    })();
    loader.catch(() => {
      loader = null; // allow retry after a failed load
    });
  }
  return loader;
}

interface Slot {
  file: File | null;
  url: string | null;
}

function verdictFrom(distance: number): FaceResult {
  const score = Math.round(Math.max(0, Math.min(1, (0.9 - distance) / 0.6)) * 100);
  const caveat =
    "Results depend on photo quality — angle, lighting, expression, age gap and occlusion all shift the score. Treat this as one signal among many, never as proof of identity.";
  if (distance <= 0.45) {
    return {
      distance,
      similarity: score,
      verdict: "match",
      verdictLabel: "MATCH — descriptors within the high-confidence band",
      explanation: `Euclidean distance ${distance.toFixed(3)} is inside the range normally seen when both photos show the same person (≤ 0.45). ${caveat}`,
    };
  }
  if (distance <= 0.6) {
    return {
      distance,
      similarity: score,
      verdict: "likely",
      verdictLabel: "LIKELY MATCH — same person, moderate confidence",
      explanation: `Distance ${distance.toFixed(3)} sits in the probable-same-person band (0.45–0.60). Differences may come from pose, lighting or time between photos. ${caveat}`,
    };
  }
  if (distance <= 0.75) {
    return {
      distance,
      similarity: score,
      verdict: "uncertain",
      verdictLabel: "UNCERTAIN — borderline, inconclusive",
      explanation: `Distance ${distance.toFixed(3)} is borderline (0.60–0.75): the faces share some similarity but not enough to call. Re-run with clearer, frontal, similarly-lit photos. ${caveat}`,
    };
  }
  return {
    distance,
    similarity: score,
    verdict: "different",
    verdictLabel: "DIFFERENT — descriptors are far apart",
    explanation: `Distance ${distance.toFixed(3)} exceeds 0.75, the range typical of two different people. ${caveat}`,
  };
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

export function FacePanel({
  onCollect,
}: {
  onCollect: (patch: Partial<ReportPayload>) => void;
}) {
  const [a, setA] = useState<Slot>({ file: null, url: null });
  const [b, setB] = useState<Slot>({ file: null, url: null });
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<"idle" | "loading" | "running" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FaceResult | null>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  function setSlot(slot: "a" | "b", f: File | null) {
    const setter = slot === "a" ? setA : setB;
    setter((prev) => {
      if (prev.url) URL.revokeObjectURL(prev.url);
      return { file: f, url: f ? URL.createObjectURL(f) : null };
    });
    setResult(null);
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
      setError(
        `Failed to load AI models: ${e instanceof Error ? e.message : "unknown error"}. Make sure /models is served.`,
      );
      setPhase("idle");
    }
  }

  async function run() {
    if (!a.file || !b.file || !consent || phase === "loading" || phase === "running") return;
    setError(null);
    setResult(null);
    setPhase("loading");
    const t0 = Date.now();
    try {
      const faceapi = await loadModels();
      setModelsReady(true);
      setPhase("running");

      async function describe(file: File, which: string) {
        const img = await faceapi.bufferToImage(file);
        const det = await faceapi
          .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.4 }))
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (!det) {
          throw new Error(
            `No face detected in image ${which}. Use a sharp, well-lit photo where one face fills a good part of the frame.`,
          );
        }
        return det.descriptor;
      }

      const [da, db] = await Promise.all([describe(a.file, "A"), describe(b.file, "B")]);
      const distance = faceapi.euclideanDistance(da, db);
      const vr = verdictFrom(distance);
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
      hint="Confirms whether two photos show the same person using a deep face-recognition model running entirely in your browser. This is verification between images you supply — it does not identify strangers from any database."
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
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            I confirm I have the right to compare these images — they are mine, or I have explicit
            permission from the people shown.
          </span>
        </label>
        <button
          className="btn btn-ghost btn-sm"
          onClick={preload}
          disabled={busy || modelsReady}
          title="Download the ~7 MB models ahead of time"
        >
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
        <b>Privacy:</b> photos never leave your device — detection and descriptor extraction run locally via
        TensorFlow.js; only the numeric result is stored for the report. Models load once from{" "}
        <span className="mono">/models</span> (~7 MB, cached by your browser).
      </div>

      <ErrorBoxLocal error={error} />

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
            <span>euclidean distance: {result.distance.toFixed(4)}</span>
            <span>bands: ≤0.45 match · ≤0.60 likely · ≤0.75 uncertain · &gt;0.75 different</span>
            <span>computed in {elapsed.toFixed(2)}s</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function ErrorBoxLocal({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error-box">⚠ {error}</div>;
}
