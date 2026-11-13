"use client";

import { useMemo, useRef, useState } from "react";
import { postJson } from "@/lib/client";
import { analyzeFace, bandOf, fileToImage, loadFaceModels } from "@/lib/face";
import { Card, DorkGrid, ErrorBox } from "./common";
import type { Dork } from "@/lib/dorks";

interface ExifSummary {
  make?: string;
  model?: string;
  lens?: string;
  software?: string;
  artist?: string;
  description?: string;
  capturedAt?: string;
  lat?: number;
  lon?: number;
  fieldCount: number;
}

interface GalleryItem {
  id: string;
  name: string;
  url: string;
  descriptor: Float32Array;
}

interface MatchResult {
  item: GalleryItem;
  distance: number;
}

const ACCURATE = { inputSize: 512, scoreThreshold: 0.5 };
const FAST = { inputSize: 416, scoreThreshold: 0.4 };

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function extractExif(file: File): Promise<ExifSummary> {
  const out: ExifSummary = { fieldCount: 0 };
  try {
    const mod = (await import("exifr")) as unknown as {
      parse?: (f: File, o?: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;
      default?: { parse: (f: File, o?: Record<string, unknown>) => Promise<Record<string, unknown> | undefined> };
    };
    const parse = mod.parse ?? mod.default?.parse;
    if (!parse) return out;
    const meta = await parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      ifd0: true,
      translateKeys: true,
      translateValues: true,
    }).catch(() => undefined);
    if (!meta) return out;
    out.fieldCount = Object.keys(meta).length;
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 160) : undefined);
    out.make = s(meta.Make) ?? s(meta.make);
    out.model = s(meta.Model) ?? s(meta.model);
    out.lens = s(meta.LensModel) ?? s(meta.LensMake) ?? s(meta.lensModel);
    out.software = s(meta.Software) ?? s(meta.software);
    out.artist = s(meta.Artist) ?? s(meta.artist) ?? s(meta.Copyright);
    out.description = s(meta.ImageDescription) ?? s(meta.description);
    const dt = meta.DateTimeOriginal ?? meta.CreateDate ?? meta.ModifyDate;
    if (dt instanceof Date && !isNaN(dt.getTime())) out.capturedAt = dt.toISOString();
    else if (typeof dt === "string") out.capturedAt = dt;
    const lat = (meta.latitude ?? meta.Latitude) as number | undefined;
    const lon = (meta.longitude ?? meta.Longitude) as number | undefined;
    if (typeof lat === "number" && typeof lon === "number" && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      out.lat = lat;
      out.lon = lon;
    }
  } catch {
    /* EXIF extraction is best-effort */
  }
  return out;
}

function reverseDorks(url: string): Dork[] {
  const u = encodeURIComponent(url);
  return [
    { engine: "Google Lens", url: `https://lens.google.com/uploadbyurl?url=${u}` },
    { engine: "Yandex Images", url: `https://yandex.com/images/search?rpt=imageview&url=${u}` },
    { engine: "Bing Visual", url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${u}` },
    { engine: "TinEye", url: `https://tineye.com/search?url=${u}` },
    { engine: "Baidu 识图", url: `https://graph.baidu.com/s?tn=baiduimage&image=${u}` },
    { engine: "Google (manual)", url: "https://images.google.com/" },
  ];
}

function exifDorks(exif: ExifSummary): Dork[] {
  const dorks: Dork[] = [];
  if (exif.lat != null && exif.lon != null) {
    const c = `${exif.lat.toFixed(6)}, ${exif.lon.toFixed(6)}`;
    dorks.push(
      { engine: "Map — OSM", url: `https://www.openstreetmap.org/?mlat=${exif.lat}&mlon=${exif.lon}#map=15/${exif.lat}/${exif.lon}` },
      { engine: "Map — Google", url: `https://www.google.com/maps?q=${encodeURIComponent(c)}` },
      { engine: "Search coords", url: `https://www.google.com/search?q=${encodeURIComponent(`"${c}"`)}` },
    );
  }
  const cam = [exif.make, exif.model].filter(Boolean).join(" ");
  if (cam) {
    dorks.push({ engine: "Camera dork", url: `https://www.google.com/search?q=${encodeURIComponent(`"${cam}"`)}` });
  }
  return dorks;
}

/* ── Main panel ─────────────────────────────────────────── */

export function ImagePanel() {
  // ── reverse-search state ──
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exif, setExif] = useState<ExifSummary | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [hosting, setHosting] = useState(false);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── gallery search state ──
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [mode, setMode] = useState<"fast" | "accurate">("fast");
  const [probe, setProbe] = useState<{ file: File; url: string } | null>(null);
  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const probeRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function onPick(f: File | null) {
    if (!f || !f.type.startsWith("image/")) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setExif(null);
    setHash(null);
    setDims(null);
    setHostedUrl(null);
    setHostError(null);
    setExif(await extractExif(f));
    setHash(await sha256Hex(f).catch(() => null));
    try {
      const img = await fileToImage(f);
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    } catch {
      /* ignore */
    }
  }

  async function host() {
    if (!file || hosting) return;
    setHosting(true);
    setHostError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("read failed"));
        fr.readAsDataURL(file);
      });
      const b64 = dataUrl.split(",")[1] ?? "";
      const res = await postJson<{ url: string; expiresInSeconds: number; note?: string }>(
        "/api/image",
        { mime: file.type, data: b64 },
      );
      setHostedUrl(res.url);
    } catch (e) {
      setHostError(e instanceof Error ? e.message : "Hosting failed.");
    } finally {
      setHosting(false);
    }
  }

  async function copyUrl() {
    if (!hostedUrl) return;
    try {
      await navigator.clipboard.writeText(hostedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  async function addGalleryFiles(files: FileList | null) {
    if (!files?.length) return;
    setGalleryError(null);
    setGalleryBusy(true);
    try {
      const faceapi = await loadFaceModels();
      const opts = mode === "accurate" ? ACCURATE : FAST;
      const added: GalleryItem[] = [];
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        if (gallery.length + added.length >= 30) {
          setGalleryError("Gallery limit is 30 images.");
          break;
        }
        try {
          const img = await fileToImage(f);
          const analysis = await analyzeFace(faceapi, img, opts, false);
          added.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: f.name,
            url: URL.createObjectURL(f),
            descriptor: analysis.descriptor,
          });
        } catch (e) {
          setGalleryError(
            `${f.name}: ${e instanceof Error && e.message === "NO_FACE" ? "no face detected" : "could not process"}`,
          );
        }
      }
      if (added.length) setGallery((g) => [...g, ...added]);
    } catch (e) {
      setGalleryError(e instanceof Error ? e.message : "Failed to load face models.");
    } finally {
      setGalleryBusy(false);
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  async function searchGallery() {
    if (!probe || !gallery.length || searching) return;
    setSearching(true);
    setGalleryError(null);
    setMatches(null);
    try {
      const faceapi = await loadFaceModels();
      const opts = mode === "accurate" ? ACCURATE : FAST;
      const img = await fileToImage(probe.file);
      const analysis = await analyzeFace(faceapi, img, opts, false);
      const results: MatchResult[] = gallery.map((item) => ({
        item,
        distance: faceapi.euclideanDistance(analysis.descriptor, item.descriptor),
      }));
      results.sort((a, b) => a.distance - b.distance);
      setMatches(results);
    } catch (e) {
      setGalleryError(
        e instanceof Error && e.message === "NO_FACE"
          ? "No face found in the probe photo."
          : e instanceof Error
            ? e.message
            : "Gallery search failed.",
      );
    } finally {
      setSearching(false);
      if (probeRef.current) probeRef.current.value = "";
    }
  }

  function removeItem(id: string) {
    setGallery((g) => {
      const hit = g.find((i) => i.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return g.filter((i) => i.id !== id);
    });
    setMatches(null);
  }

  function clearGallery() {
    gallery.forEach((i) => URL.revokeObjectURL(i.url));
    setGallery([]);
    setMatches(null);
  }

  const exifDorkList = useMemo(() => (exif ? exifDorks(exif) : []), [exif]);

  return (
    <>
      <Card
        title="Reverse image & face search"
        ico="🔍"
        hint="Upload a photo, host it privately with an expiring link, then run it through the internet's major visual indexes in one click — Google Lens, Yandex (strongest public face matcher), Bing, TinEye and Baidu. Extracts EXIF/GPS forensics locally. This deep-links public engines with your own image; it does not scrape results or query face databases of strangers."
        right={<span className={`pill ${hostedUrl ? "good" : "dim"}`}>{hostedUrl ? "hosted ✓" : "not hosted"}</span>}
      >
        <div className="face-grid">
          <div
            className="dropzone"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onPick(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <span className="dz-badge">Photo</span>
            {previewUrl ? (
              <img src={previewUrl} alt="Upload preview" />
            ) : (
              <>
                <div className="dz-title">Drop image or click</div>
                <div className="dz-hint">JPG / PNG / WEBP / GIF · max 6 MB</div>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                onPick(e.target.files?.[0] ?? null);
                e.currentTarget.value = "";
              }}
            />
          </div>

          <div>
            {file && (
              <dl className="kv" style={{ marginTop: 0 }}>
                <dt>File</dt>
                <dd>
                  {file.name.slice(0, 40)} · {fmtBytes(file.size)}
                  {dims && ` · ${dims.w}×${dims.h}px`}
                </dd>
                <dt>SHA-256</dt>
                <dd className="mono" style={{ fontSize: 11 }}>
                  {hash ? `${hash.slice(0, 32)}…` : "…"}
                </dd>
                <dt>Captured</dt>
                <dd>{exif?.capturedAt ?? <span className="muted">not in EXIF</span>}</dd>
                <dt>Camera</dt>
                <dd>
                  {[exif?.make, exif?.model].filter(Boolean).join(" ") || (
                    <span className="muted">not in EXIF</span>
                  )}
                  {exif?.lens ? ` · ${exif.lens}` : ""}
                </dd>
                <dt>Software</dt>
                <dd>{exif?.software ?? <span className="muted">—</span>}</dd>
                <dt>Author / desc</dt>
                <dd>
                  {[exif?.artist, exif?.description].filter(Boolean).join(" — ") || (
                    <span className="muted">—</span>
                  )}
                </dd>
                <dt>GPS</dt>
                <dd>
                  {exif?.lat != null && exif?.lon != null ? (
                    <span className="pill warn">
                      {exif.lat.toFixed(5)}, {exif.lon.toFixed(5)}
                    </span>
                  ) : (
                    <span className="muted">no coordinates in EXIF</span>
                  )}
                </dd>
                <dt>EXIF fields</dt>
                <dd>{exif?.fieldCount ?? 0}</dd>
              </dl>
            )}

            {!file && (
              <div className="empty-box" style={{ marginTop: 0 }}>
                Drop a photo to see forensics (EXIF, GPS, hash) and generate reverse-search links.
              </div>
            )}

            {file && (
              <div className="row mt8">
                <button className="btn btn-primary" onClick={host} disabled={hosting}>
                  {hosting ? "Hosting securely…" : hostedUrl ? "Re-host" : "Host & generate search links"}
                </button>
              </div>
            )}
            <ErrorBox error={hostError} />
            {hostedUrl && (
              <div className="hosted-box">
                <div className="row">
                  <span className="pill good">expiring link ready</span>
                  <button className="btn btn-ghost btn-sm" onClick={copyUrl}>
                    {copied ? "Copied ✓" : "Copy URL"}
                  </button>
                  <span className="small muted">expires in 30 min · purged in 24 h</span>
                </div>
                <div className="mono hosted-url">{hostedUrl}</div>
                <div className="section-sub">Run the face/image across the internet</div>
                <DorkGrid dorks={reverseDorks(hostedUrl)} />
              </div>
            )}
          </div>
        </div>

        {exifDorkList.length > 0 && (
          <>
            <div className="section-sub">Forensic shortcuts from metadata</div>
            <DorkGrid dorks={exifDorkList} />
          </>
        )}
      </Card>

      <Card
        title="Gallery face search (1:N)"
        ico="▦"
        hint="The real face-search algorithm — build a gallery of photos you have the right to index (max 30), then search a probe face against all of them. 128-d descriptors, ranked by distance, entirely in your browser. Nothing is uploaded."
        right={<span className="pill info mono">{gallery.length}/30 indexed</span>}
      >
        <div className="row">
          <div className="mode-toggle" role="radiogroup" aria-label="Detector mode">
            <button className={`mode-btn ${mode === "fast" ? "on" : ""}`} onClick={() => setMode("fast")} disabled={galleryBusy || searching}>
              ⚡ Fast
            </button>
            <button className={`mode-btn ${mode === "accurate" ? "on" : ""}`} onClick={() => setMode("accurate")} disabled={galleryBusy || searching}>
              🎯 Accurate
            </button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => galleryRef.current?.click()} disabled={galleryBusy}>
            {galleryBusy ? "Indexing…" : "+ Add photos"}
          </button>
          {gallery.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={clearGallery} disabled={galleryBusy}>
              Clear gallery
            </button>
          )}
          <span className="spacer" />
          <span className="small muted">Index only photos you own or have permission to use.</span>
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => addGalleryFiles(e.target.files)}
          />
        </div>

        {gallery.length > 0 && (
          <div className="gallery-grid">
            {gallery.map((item) => (
              <div key={item.id} className="gallery-item">
                <img src={item.url} alt={item.name} />
                <button className="gallery-x" onClick={() => removeItem(item.id)} title="Remove">
                  ×
                </button>
                <span className="gallery-name" title={item.name}>
                  {item.name}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="face-grid mt14">
          <div
            className="dropzone"
            onClick={() => probeRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f && f.type.startsWith("image/")) {
                if (probe?.url) URL.revokeObjectURL(probe.url);
                setProbe({ file: f, url: URL.createObjectURL(f) });
                setMatches(null);
              }
            }}
          >
            <span className="dz-badge">Probe</span>
            {probe ? (
              <img src={probe.url} alt="Probe preview" />
            ) : (
              <>
                <div className="dz-title">Drop the face to search for</div>
                <div className="dz-hint">compared against every gallery photo</div>
              </>
            )}
            <input
              ref={probeRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && f.type.startsWith("image/")) {
                  if (probe?.url) URL.revokeObjectURL(probe.url);
                  setProbe({ file: f, url: URL.createObjectURL(f) });
                  setMatches(null);
                }
                e.currentTarget.value = "";
              }}
            />
          </div>
          <div className="probe-side">
            <div className="empty-box" style={{ marginTop: 0 }}>
              {gallery.length === 0
                ? "Add gallery photos first — then drop a probe face to search them all."
                : `Ready to search ${gallery.length} photo${gallery.length > 1 ? "s" : ""}.`}
            </div>
            <button
              className="btn btn-primary mt14"
              style={{ width: "100%" }}
              onClick={searchGallery}
              disabled={!probe || !gallery.length || searching || galleryBusy}
            >
              {searching ? "Searching gallery…" : `Search ${gallery.length} image${gallery.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>

        <ErrorBox error={galleryError} />

        {matches && matches.length > 0 && (
          <>
            <div className="section-sub">Ranked matches</div>
            <div className="match-list">
              {matches.map((m) => {
                const band = bandOf(m.distance);
                const score = Math.round(Math.max(0, Math.min(1, (0.9 - m.distance) / 0.6)) * 100);
                return (
                  <div key={m.item.id} className={`match-row band-${band}`}>
                    <img src={m.item.url} alt={m.item.name} />
                    <div className="match-info">
                      <div className="match-name">{m.item.name}</div>
                      <div className="mono small muted">distance {m.distance.toFixed(4)}</div>
                    </div>
                    <span className={`pill ${band === "match" ? "good" : band === "likely" ? "info" : band === "uncertain" ? "warn" : "bad"}`}>
                      {band}
                    </span>
                    <span className="match-score">{score}%</span>
                  </div>
                );
              })}
            </div>
            <p className="small muted mt8">
              Bands: ≤0.45 match · ≤0.60 likely · ≤0.75 uncertain · &gt;0.75 different. First row is the
              closest face in your gallery.
            </p>
          </>
        )}
      </Card>
    </>
  );
}
