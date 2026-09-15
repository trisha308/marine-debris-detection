import React, { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:8000/detect";
const ANOMALY_THRESHOLD = 0.4;

export default function App() {
  const [file, setFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [detections, setDetections] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | analyzing | done | error
  const [errorMessage, setErrorMessage] = useState("");
  const [activeIndex, setActiveIndex] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const [booting, setBooting] = useState(true);
  const [bootLine, setBootLine] = useState(0);
  const [navSolid, setNavSolid] = useState(false);

  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const toolRef = useRef(null);

  // ---- preloader ----------------------------------------------------

  const BOOT_LINES = [
    "CALIBRATING TRANSDUCER ARRAY",
    "SYNCING SONAR CLOCK",
    "LOADING DETECTION MODEL",
    "ARRAY READY",
  ];

  useEffect(() => {
    if (bootLine >= BOOT_LINES.length - 1) {
      const finish = setTimeout(() => setBooting(false), 550);
      return () => clearTimeout(finish);
    }
    const step = setTimeout(() => setBootLine((n) => n + 1), 420);
    return () => clearTimeout(step);
  }, [bootLine]);

  const scrollToTool = () => {
    toolRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const onScroll = () => setNavSolid(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ---- file handling ----------------------------------------------------

  const loadFile = useCallback((incoming) => {
    if (!incoming || !incoming.type.startsWith("image/")) return;
    setFile(incoming);
    setImageUrl(URL.createObjectURL(incoming));
    setDetections(null);
    setStatus("idle");
    setErrorMessage("");
    setActiveIndex(null);
  }, []);

  const onInputChange = (e) => loadFile(e.target.files?.[0]);

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    loadFile(e.dataTransfer.files?.[0]);
  };

  const reset = () => {
    setFile(null);
    setImageUrl(null);
    setDetections(null);
    setStatus("idle");
    setErrorMessage("");
    setActiveIndex(null);
  };

  // ---- analysis -----------------------------------------------------------

  const analyze = async () => {
    if (!file) return;
    setStatus("analyzing");
    setErrorMessage("");

    const body = new FormData();
    body.append("file", file, file.name);

    try {
      const res = await fetch(API_URL, { method: "POST", body });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();
      setDetections(data.detections || []);
      setStatus("done");
    } catch (err) {
      const message =
        err instanceof TypeError
          ? "Can't reach the detection server. Confirm the FastAPI backend is running on port 8000."
          : err.message;
      setErrorMessage(message);
      setStatus("error");
    }
  };

  // ---- canvas overlay: keep boxes aligned to the rendered image size ----

  const drawBoxes = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !naturalSize.w) return;

    const displayW = img.clientWidth;
    const displayH = img.clientHeight;
    canvas.width = displayW;
    canvas.height = displayH;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, displayW, displayH);
    if (!detections || !detections.length) return;

    const scaleX = displayW / naturalSize.w;
    const scaleY = displayH / naturalSize.h;

    detections.forEach((d, i) => {
      const isAnomaly = d.confidence < ANOMALY_THRESHOLD;
      const isActive = i === activeIndex;
      const x = d.x * scaleX;
      const y = d.y * scaleY;
      const w = d.width * scaleX;
      const h = d.height * scaleY;

      const color = isAnomaly ? "#f2a93c" : "#4fd8c4";

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = isActive ? 3 : 1.5;
      if (isActive) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
      }
      ctx.strokeRect(x, y, w, h);

      // corner ticks, console-instrument styling instead of a plain box
      const tick = 8;
      ctx.lineWidth = isActive ? 3 : 2;
      ctx.shadowBlur = 0;
      [
        [x, y, 1, 1],
        [x + w, y, -1, 1],
        [x, y + h, 1, -1],
        [x + w, y + h, -1, -1],
      ].forEach(([cx, cy, dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy + tick * dy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + tick * dx, cy);
        ctx.stroke();
      });

      // label chip
      const label = isAnomaly
        ? "ANOMALY"
        : d.class.toUpperCase();
      const text = `${label} ${Math.round(d.confidence * 100)}%`;
      ctx.font = "600 11px 'JetBrains Mono', monospace";
      const textW = ctx.measureText(text).width;
      const chipY = y > 20 ? y - 18 : y + h + 4;

      ctx.fillStyle = "rgba(7, 24, 34, 0.88)";
      ctx.fillRect(x, chipY, textW + 10, 16);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, chipY, textW + 10, 16);
      ctx.fillStyle = color;
      ctx.fillText(text, x + 5, chipY + 12);

      ctx.restore();
    });
  }, [detections, naturalSize, activeIndex]);

  useEffect(() => {
    drawBoxes();
    const handleResize = () => drawBoxes();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawBoxes]);

  // scanning sweep animation frame while analyzing
  useEffect(() => {
    if (status !== "analyzing") return;
    let start = null;
    const el = frameRef.current;
    const tick = (ts) => {
      if (!start) start = ts;
      const elapsed = (ts - start) / 1400; // seconds-ish
      const pct = (elapsed % 1) * 100;
      if (el) el.style.setProperty("--sweep-pos", `${pct}%`);
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  // ---- derived stats --------------------------------------------------

  const stats = (() => {
    if (!detections) return null;
    const count = detections.length;
    const anomalies = detections.filter((d) => d.confidence < ANOMALY_THRESHOLD).length;
    const avgConfidence = count
      ? Math.round((detections.reduce((s, d) => s + d.confidence, 0) / count) * 100)
      : 0;
    return { count, anomalies, avgConfidence };
  })();

  return (
    <div className="app">
      {booting && (
        <div className={`preloader ${bootLine >= BOOT_LINES.length - 1 ? "preloader--done" : ""}`}>
          <div className="preloader-rings">
            <span className="ping ping-1" />
            <span className="ping ping-2" />
            <span className="ping ping-3" />
            <span className="preloader-core" />
          </div>
          <p className="preloader-line">{BOOT_LINES[bootLine]}</p>
          <div className="preloader-bar">
            <div
              className="preloader-bar-fill"
              style={{ width: `${((bootLine + 1) / BOOT_LINES.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      <nav className={`taskbar ${navSolid ? "taskbar--solid" : ""}`}>
        <span className="taskbar-mark" />
        <span className="taskbar-name">Marine Debris Detection</span>
      </nav>

      <section className="hero">
        <div className="hero-depth" aria-hidden="true">
          <span className="depth-line" style={{ "--d": 0 }} />
          <span className="depth-line" style={{ "--d": 1 }} />
          <span className="depth-line" style={{ "--d": 2 }} />
          <span className="depth-line" style={{ "--d": 3 }} />
        </div>

        <div className="hero-sonar" aria-hidden="true">
          <span className="sonar-ring sonar-ring-1" />
          <span className="sonar-ring sonar-ring-2" />
          <span className="sonar-ring sonar-ring-3" />
          <span className="sonar-sweep-arm" />
          <span className="sonar-blip" style={{ "--bx": "62%", "--by": "38%", "--delay": "0.2s" }} />
          <span className="sonar-blip" style={{ "--bx": "30%", "--by": "68%", "--delay": "1.4s" }} />
          <span className="sonar-blip sonar-blip--anomaly" style={{ "--bx": "74%", "--by": "70%", "--delay": "2.6s" }} />
        </div>

        <div className="hero-content">
          <div className="hero-kicker">
            <span className="topbar-mark" />
            Side-scan sonar &middot; automated survey review
          </div>
          <h1 className="hero-title">
            Find what's resting on the seabed before it costs you a survey.
          </h1>
          <p className="hero-sub">
            Feed in a sonar pass. The model walks every frame, draws a box around
            anything that looks like debris, and flags the readings it isn't sure
            about so a person can make the final call.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={scrollToTool}>
              Scan an image
            </button>
            <a className="hero-link" href="#tool" onClick={(e) => { e.preventDefault(); scrollToTool(); }}>
              See how detection works
            </a>
          </div>
          <dl className="hero-stats">
            <div className="hero-stat">
              <dt>Confidence floor</dt>
              <dd>{Math.round(ANOMALY_THRESHOLD * 100)}%</dd>
            </div>
            <div className="hero-stat">
              <dt>Input</dt>
              <dd>JPG / PNG</dd>
            </div>
            <div className="hero-stat">
              <dt>Review</dt>
              <dd>Per-object log</dd>
            </div>
          </dl>
        </div>

        <button className="scroll-cue" onClick={scrollToTool} aria-label="Scroll to the detection tool">
          <span className="scroll-cue-line" />
          <span className="scroll-cue-text">Begin scan</span>
        </button>
      </section>

      <div className="tool-anchor" id="tool" ref={toolRef}>
        <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-mark" />
            <div>
              <h1>Marine Debris Detection</h1>
              <p>Side-scan sonar analysis &amp; anomaly flagging</p>
            </div>
          </div>
          <div className="topbar-status">
            <span className={`status-dot ${status === "error" ? "status-dot--error" : ""}`} />
            {status === "analyzing" ? "PROCESSING" : status === "error" ? "SERVER UNREACHABLE" : "SYSTEM ONLINE"}
          </div>
        </header>

        <main className="layout">
          <section className="stage" ref={frameRef}>
            {!imageUrl ? (
              <label
                className={`dropzone ${isDragging ? "dropzone--active" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
              >
                <input type="file" accept="image/*" onChange={onInputChange} hidden />
                <div className="dropzone-glyph" />
                <p className="dropzone-title">Drop a sonar image here</p>
                <p className="dropzone-sub">or click to browse &middot; JPG / PNG</p>
              </label>
            ) : (
              <>
                <div className="stage-frame">
                  <img
                    ref={imgRef}
                    src={imageUrl}
                    alt="Uploaded sonar scan"
                    onLoad={(e) => {
                      setNaturalSize({
                        w: e.target.naturalWidth,
                        h: e.target.naturalHeight,
                      });
                    }}
                  />
                  <canvas ref={canvasRef} className="overlay" />
                  {status === "analyzing" && (
                    <div className="sweep" />
                  )}
                  {status === "analyzing" && (
                    <div className="scanning-label">ANALYZING SCAN&hellip;</div>
                  )}
                </div>

                <div className="stage-actions">
                  <button className="btn btn-ghost" onClick={reset}>
                    Replace image
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={analyze}
                    disabled={status === "analyzing"}
                  >
                    {status === "analyzing" ? "Analyzing…" : "Run analysis"}
                  </button>
                </div>

                {status === "error" && (
                  <div className="banner banner--error">{errorMessage}</div>
                )}
              </>
            )}
          </section>

          <aside className="sidebar">
            <div className="panel">
              <h2 className="panel-title">Readout</h2>
              {!stats ? (
                <p className="panel-empty">Run an analysis to see detection metrics.</p>
              ) : (
                <div className="readout">
                  <ReadoutRow label="Objects detected" value={stats.count} />
                  <ReadoutRow label="Average confidence" value={`${stats.avgConfidence}%`} />
                  <ReadoutRow
                    label="Anomalies"
                    value={stats.anomalies}
                    warn={stats.anomalies > 0}
                  />
                </div>
              )}
              {stats && stats.anomalies > 0 && (
                <div className="banner banner--warn">
                  {stats.anomalies} low-confidence detection{stats.anomalies > 1 ? "s" : ""} flagged for human review.
                </div>
              )}
              {stats && stats.anomalies === 0 && (
                <div className="banner banner--ok">No anomalies detected.</div>
              )}
            </div>

            <div className="panel panel-grow">
              <h2 className="panel-title">Detection log</h2>
              {!detections || detections.length === 0 ? (
                <p className="panel-empty">
                  {detections ? "No objects detected in this scan." : "No detections yet."}
                </p>
              ) : (
                <ul className="log">
                  {detections.map((d, i) => {
                    const isAnomaly = d.confidence < ANOMALY_THRESHOLD;
                    return (
                      <li
                        key={i}
                        className={`log-row ${activeIndex === i ? "log-row--active" : ""}`}
                        onMouseEnter={() => setActiveIndex(i)}
                        onMouseLeave={() => setActiveIndex(null)}
                      >
                        <span className="log-index">{String(i + 1).padStart(2, "0")}</span>
                        <span className={`log-class ${isAnomaly ? "log-class--anomaly" : ""}`}>
                          {isAnomaly ? "Anomaly" : d.class}
                        </span>
                        <span className="log-confidence">
                          {Math.round(d.confidence * 100)}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </main>

        <footer className="footer">
          <span>Detections run locally against your FastAPI backend &middot; nothing leaves this device.</span>
        </footer>
      </div>
    </div>
  );
}

function ReadoutRow({ label, value, warn }) {
  return (
    <div className="readout-row">
      <span className="readout-label">{label}</span>
      <span className={`readout-value ${warn ? "readout-value--warn" : ""}`}>{value}</span>
    </div>
  );
}