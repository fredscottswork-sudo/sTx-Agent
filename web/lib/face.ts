// Shared client-side face engine (used by face-verify and gallery-search panels).
import type { FaceResult } from "@/lib/types";

export type Faceapi = typeof import("@vladmandic/face-api");

export const MODELS_URL = "/models";

let loader: Promise<Faceapi> | null = null;

export async function loadFaceModels(): Promise<Faceapi> {
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

export interface FaceAnalysis {
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

export interface DetectOpts {
  inputSize: number;
  scoreThreshold: number;
}

export function detectorOptions(faceapi: Faceapi, opts: DetectOpts) {
  return opts.inputSize === 512
    ? new faceapi.SsdMobilenetv1Options({ minConfidence: opts.scoreThreshold })
    : new faceapi.TinyFaceDetectorOptions({
        inputSize: opts.inputSize as 128 | 160 | 224 | 320 | 416 | 512,
        scoreThreshold: opts.scoreThreshold,
      });
}

/**
 * Detect the largest face, compute its 128-d descriptor, and (optionally)
 * age / gender / expression attributes + simple image-quality metrics.
 */
export async function analyzeFace(
  faceapi: Faceapi,
  img: HTMLImageElement,
  opts: DetectOpts,
  withAttributes = true,
): Promise<FaceAnalysis> {
  const detOpts = detectorOptions(faceapi, opts);

  const base = faceapi.detectAllFaces(img, detOpts).withFaceLandmarks().withFaceDescriptors();
  const dets = withAttributes
    ? await base.withAgeAndGender().withFaceExpressions()
    : await base;
  if (!dets.length) throw new Error("NO_FACE");

  let bestIdx = 0;
  let bestArea = -1;
  dets.forEach((d, i) => {
    const a = d.detection.box.width * d.detection.box.height;
    if (a > bestArea) {
      bestArea = a;
      bestIdx = i;
    }
  });
  const primary = dets[bestIdx] as (typeof dets)[number] & {
    age?: number;
    gender?: string;
    expressions?: { asSortedArray: () => { expression: string; probability: number }[] };
  };
  const dominant =
    withAttributes && primary.expressions ? primary.expressions.asSortedArray()[0] ?? null : null;

  const box = primary.detection.box;
  const sizePct = Math.round(
    ((box.width * box.height) / (img.naturalWidth * img.naturalHeight)) * 100,
  );

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
    age: withAttributes && typeof primary.age === "number" ? primary.age : null,
    gender: withAttributes && primary.gender ? primary.gender : null,
    expression: dominant?.expression ?? null,
    expressionProb: dominant?.probability ?? null,
    brightness,
    sizePct,
  };
}

export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image file."));
    };
    img.src = url;
  });
}

export function verdictFrom(distance: number, mode: "fast" | "accurate"): FaceResult {
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

export function bandOf(distance: number): "match" | "likely" | "uncertain" | "different" {
  if (distance <= 0.45) return "match";
  if (distance <= 0.6) return "likely";
  if (distance <= 0.75) return "uncertain";
  return "different";
}
