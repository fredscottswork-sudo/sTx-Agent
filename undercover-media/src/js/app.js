/* ==========================================================================
   UnderCover Media — front-end behaviour
   No frameworks. Progressive enhancement over static HTML.
   ========================================================================== */

(() => {
  "use strict";

  /* ---------------------------------------------------------------------
     CONFIG
     Set STREAM_URL to your live audio endpoint (Icecast/Shoutcast/HLS .m4a).
     Leave it empty to run the player in demo mode.
  --------------------------------------------------------------------- */
  const STREAM_URL = "";

  const BASE = document.body.dataset.base || "";
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const state = { playerOpen: false, playing: false, searchIndex: null };

  // Keep off-screen chrome out of the tab order until it is opened.
  ["#player", "#drawer", "#search"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el && "inert" in el) el.inert = true;
  });

  /* ------------------------------------------------------------- Toast -- */

  let toastTimer;
  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2800);
  }

  /* ------------------------------------------------------------ Header -- */

  const head = $(".site-head");
  let lastY = window.scrollY;
  const onScroll = () => {
    const y = window.scrollY;
    if (head) head.classList.toggle("is-stuck", y > 40);
    const toTop = $(".to-top");
    if (toTop) toTop.classList.toggle("is-visible", y > 700);
    const bar = $(".read-progress");
    if (bar) {
      const article = $(".article-body");
      if (article) {
        const start = article.offsetTop - 120;
        const total = article.offsetHeight;
        const pct = Math.min(100, Math.max(0, ((y - start) / total) * 100));
        bar.style.width = pct + "%";
      }
    }
    lastY = y;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const toTop = $(".to-top");
  if (toTop) toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  /* ------------------------------------------------------------ Drawer -- */

  const drawer = $("#drawer");
  const drawerTriggers = $$("[data-drawer-open]");
  const drawerClose = $$("[data-drawer-close]");

  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add("is-open");
    drawer.removeAttribute("aria-hidden");
    if ("inert" in drawer) drawer.inert = false;
    drawerTriggers.forEach((b) => b.setAttribute("aria-expanded", "true"));
    document.body.classList.add("is-locked");
    const first = $(".drawer__panel a, .drawer__panel button", drawer);
    if (first) first.focus({ preventScroll: true });
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    if ("inert" in drawer) drawer.inert = true;
    drawerTriggers.forEach((b) => b.setAttribute("aria-expanded", "false"));
    if (!searchOpen()) document.body.classList.remove("is-locked");
  }
  drawerTriggers.forEach((b) => b.addEventListener("click", openDrawer));
  drawerClose.forEach((b) => b.addEventListener("click", closeDrawer));

  /* ------------------------------------------------------------ Search -- */

  const search = $("#search");
  const searchInput = $("#search-input");
  const searchResults = $("#search-results");

  function searchOpen() {
    return !!search && search.classList.contains("is-open");
  }

  async function loadIndex() {
    if (state.searchIndex) return state.searchIndex;
    try {
      const res = await fetch(BASE + "assets/search-index.json", { cache: "force-cache" });
      state.searchIndex = await res.json();
    } catch (err) {
      state.searchIndex = [];
    }
    return state.searchIndex;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  async function runSearch(query) {
    if (!searchResults) return;
    const q = query.trim().toLowerCase();
    if (!q) {
      searchResults.innerHTML = "";
      return;
    }
    const index = await loadIndex();
    const words = q.split(/\s+/);
    const hits = index
      .map((item) => {
        const hay = `${item.title} ${item.section} ${item.deck} ${(item.tags || []).join(" ")}`.toLowerCase();
        let score = 0;
        words.forEach((w) => {
          if (item.title.toLowerCase().includes(w)) score += 4;
          if (hay.includes(w)) score += 1;
        });
        return { item, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (!hits.length) {
      searchResults.innerHTML = `<p class="search__empty">No stories matched “${escapeHtml(query)}”. Try a section name, a place or a person.</p>`;
      return;
    }
    searchResults.innerHTML = hits
      .map(({ item }) => `
        <a class="search__result" href="${BASE}${item.url}">
          <img src="${BASE}${item.image}" alt="" loading="lazy" width="90" height="60">
          <div>
            <span class="kicker">${escapeHtml(item.section)}</span>
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.deck)}</p>
          </div>
          <svg class="icon" aria-hidden="true" width="16" height="16"><use href="#i-arrow-right"></use></svg>
        </a>`)
      .join("");
  }

  function openSearch() {
    if (!search) return;
    search.classList.add("is-open");
    search.removeAttribute("hidden");
    search.setAttribute("aria-hidden", "false");
    if ("inert" in search) search.inert = false;
    document.body.classList.add("is-locked");
    loadIndex();
    setTimeout(() => searchInput && searchInput.focus(), 60);
  }
  function closeSearch() {
    if (!search) return;
    search.classList.remove("is-open");
    search.setAttribute("aria-hidden", "true");
    if ("inert" in search) search.inert = true;
    if (!drawer || !drawer.classList.contains("is-open")) document.body.classList.remove("is-locked");
    if (searchInput) searchInput.value = "";
    if (searchResults) searchResults.innerHTML = "";
  }

  $$("[data-search-open]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); closeDrawer(); openSearch(); }));
  $$("[data-search-close]").forEach((b) => b.addEventListener("click", closeSearch));

  let searchDebounce;
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      clearTimeout(searchDebounce);
      const val = e.target.value;
      searchDebounce = setTimeout(() => runSearch(val), 130);
    });
  }
  $$("[data-search-term]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!searchInput) return;
      searchInput.value = b.dataset.searchTerm;
      runSearch(b.dataset.searchTerm);
      searchInput.focus();
    })
  );

  /* ------------------------------------------------------------ Escape -- */

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (searchOpen()) closeSearch();
      else if (drawer && drawer.classList.contains("is-open")) closeDrawer();
      else if (state.playerOpen) closePlayer();
    }
    if (e.key === "/" && !searchOpen()) {
      const tag = (document.activeElement.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "textarea") {
        e.preventDefault();
        openSearch();
      }
    }
  });

  /* ------------------------------------------------------- Radio player -- */

  const player = $("#player");
  const playButtons = $$("[data-radio-toggle]");
  const audio = (() => {
    if (!STREAM_URL) return null;
    const a = new Audio();
    a.preload = "none";
    a.src = STREAM_URL;
    return a;
  
  /* ── Listen to this article (Web Speech API) ─────────────────────── */
  (function readAloud() {
    const btn = document.querySelector("[data-read-aloud]");
    if (!btn) return;
    if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) {
      btn.remove();
      return;
    }
    const article = document.querySelector("article");
    const text = () => {
      if (!article) return "";
      const parts = [];
      const h1 = article.querySelector("h1");
      if (h1) parts.push(h1.textContent.trim());
      const deck = article.querySelector(".article-head__deck");
      if (deck) parts.push(deck.textContent.trim());
      article.querySelectorAll("p, h2, blockquote, li").forEach((el) => {
        if (el.closest(".share, .article-byline, .most, .side-box, .newsletter-card, aside, footer, nav")) return;
        const t = el.textContent.trim();
        if (t) parts.push(t);
      });
      return parts.join(". ");
    };
    let speaking = false;
    const reset = () => {
      speaking = false;
      btn.classList.remove("is-on");
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", "Listen to this article");
    };
    btn.addEventListener("click", () => {
      if (speaking) { window.speechSynthesis.cancel(); reset(); return; }
      const body = text();
      if (!body) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(body);
      utter.lang = "en-GB";
      utter.rate = 1;
      utter.onend = reset;
      utter.onerror = reset;
      window.speechSynthesis.speak(utter);
      speaking = true;
      btn.classList.add("is-on");
      btn.setAttribute("aria-pressed", "true");
      btn.setAttribute("aria-label", "Stop reading");
    });
    window.addEventListener("pagehide", () => window.speechSynthesis.cancel());
  })();

})();

  function setPlaying(playing) {
    state.playing = playing;
    if (player) {
      player.classList.toggle("is-playing", playing);
      const btn = $(".player__btn", player);
      if (btn) btn.setAttribute("aria-label", playing ? "Pause live radio" : "Play live radio");
      if (btn) btn.setAttribute("aria-pressed", String(playing));
    }
    playButtons.forEach((b) => {
      b.setAttribute("aria-pressed", String(playing && state.playerOpen));
      const label = b.querySelector(".btn-listen__state span:last-child, [data-listen-label]");
      if (label) label.textContent = playing && state.playerOpen ? "Playing" : "On air";
    });
    const eq = $(".player__wave");
    if (eq) eq.setAttribute("aria-hidden", "true");
  }

  function openPlayer(autoplay = true) {
    if (!player) return;
    state.playerOpen = true;
    document.body.classList.add("player-open");
    player.setAttribute("aria-hidden", "false");
    if ("inert" in player) player.inert = false;
    if (autoplay) {
      setPlaying(true);
      if (audio) {
        audio.volume = 0.8;
        audio.play().catch(() => {
          setPlaying(false);
          toast("Live audio is not configured yet — running in demo mode.");
        });
      }
    }
  }

  function closePlayer() {
    state.playerOpen = false;
    document.body.classList.remove("player-open");
    if (player) {
      player.setAttribute("aria-hidden", "true");
      if ("inert" in player) player.inert = true;
    }
    setPlaying(false);
    if (audio) audio.pause();
  }

  function togglePlay() {
    if (!state.playerOpen) {
      openPlayer(true);
      return;
    }
    if (state.playing) {
      setPlaying(false);
      if (audio) audio.pause();
    } else {
      setPlaying(true);
      if (audio) audio.play().catch(() => toast("Could not reach the live stream."));
    }
  }

  playButtons.forEach((b) =>
    b.addEventListener("click", (e) => {
      e.preventDefault();
      if (drawer && drawer.classList.contains("is-open")) closeDrawer();
      togglePlay();
    })
  );

  const playerBtn = $(".player__btn");
  if (playerBtn) playerBtn.addEventListener("click", togglePlay);
  const playerClose = $(".player__close");
  if (playerClose) playerClose.addEventListener("click", closePlayer);

  const vol = $("#player-volume");
  if (vol) {
    vol.addEventListener("input", (e) => {
      if (audio) audio.volume = Number(e.target.value) / 100;
    });
  }

  if (player) player.setAttribute("aria-hidden", "true");

  /* -------------------------------------------------------- Video modal -- */

  const videoModal = $("#video-modal");
  const videoTriggers = $$("[data-video]");
  if (videoModal) {
    videoTriggers.forEach((trigger) => {
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        const { title, show, image, duration } = trigger.dataset;
        const t = $("#video-modal-title", videoModal);
        const s = $("#video-modal-show", videoModal);
        const img = $("#video-modal-image", videoModal);
        const d = $("#video-modal-duration", videoModal);
        if (t) t.textContent = title || "";
        if (s) s.textContent = show || "";
        if (img) { img.src = BASE + "assets/img/" + (image || "hero-politics") + "-1400.jpg"; img.alt = ""; }
        if (d) d.textContent = duration || "";
        if (typeof videoModal.showModal === "function") videoModal.showModal();
        else videoModal.setAttribute("open", "");
        document.body.classList.add("is-locked");
      });
    });
    const closeModal = () => {
      if (typeof videoModal.close === "function") videoModal.close();
      else videoModal.removeAttribute("open");
      document.body.classList.remove("is-locked");
    };
    $$("[data-video-close]", videoModal).forEach((b) => b.addEventListener("click", closeModal));
    videoModal.addEventListener("close", () => document.body.classList.remove("is-locked"));
    videoModal.addEventListener("click", (e) => {
      if (e.target === videoModal) closeModal();
    });
  }

  /* --------------------------------------------------------- Schedule --- */

  $$("[data-tabs]").forEach((group) => {
    const tabs = $$("[role=tab]", group);
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.setAttribute("aria-selected", "false"));
        tab.setAttribute("aria-selected", "true");
        $$(".schedule__panel", group).forEach((p) => p.classList.remove("is-active"));
        const panel = document.getElementById(tab.getAttribute("aria-controls"));
        if (panel) panel.classList.add("is-active");
      });
    });
  });

  /* ----------------------------------------------------- Relative time -- */

  function relTime(date) {
    const diff = Date.now() - date.getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return null;
  }

  $$("time[data-rel]").forEach((el) => {
    const d = new Date(el.getAttribute("datetime"));
    if (isNaN(d)) return;
    const rel = relTime(d);
    if (rel) {
      const label = el.dataset.relLabel ? ` (${el.textContent.trim()})` : "";
      el.textContent = rel;
      el.setAttribute("title", el.dataset.relFull || "");
    }
  });

  /* -------------------------------------------------------------- Share -- */

  $$("[data-share]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const url = window.location.href;
      const title = document.title;
      if (btn.dataset.share === "native" && navigator.share) {
        try { await navigator.share({ title, url }); } catch (_) { /* dismissed */ }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        toast("Link copied to clipboard");
      } catch (_) {
        window.prompt("Copy this link:", url);
      }
    });
  });

  /* --------------------------------------------------------- Newsletter -- */

  $$("[data-newsletter]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("input[type=email]", form);
      if (!input || !input.value.includes("@")) {
        toast("Please enter a valid email address.");
        if (input) input.focus();
        return;
      }
      toast("Thanks! This is a prototype, so no address was stored.");
      form.reset();
    });
  });

  /* ------------------------------------------------------- Homepage rail -- */

  // Keep the "latest" rail honest if it is showing relative times.
  $$("[data-clock]").forEach((el) => {
    el.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  });

  /* ── Listen to this article (Web Speech API) ─────────────────────── */
  (function readAloud() {
    const btn = document.querySelector("[data-read-aloud]");
    if (!btn) return;
    if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) {
      btn.remove();
      return;
    }
    const article = document.querySelector("article");
    const text = () => {
      if (!article) return "";
      const parts = [];
      const h1 = article.querySelector("h1");
      if (h1) parts.push(h1.textContent.trim());
      const deck = article.querySelector(".article-head__deck");
      if (deck) parts.push(deck.textContent.trim());
      article.querySelectorAll("p, h2, blockquote, li").forEach((el) => {
        if (el.closest(".share, .article-byline, .most, .side-box, .newsletter-card, aside, footer, nav")) return;
        const t = el.textContent.trim();
        if (t) parts.push(t);
      });
      return parts.join(". ");
    };
    let speaking = false;
    const reset = () => {
      speaking = false;
      btn.classList.remove("is-on");
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", "Listen to this article");
    };
    btn.addEventListener("click", () => {
      if (speaking) { window.speechSynthesis.cancel(); reset(); return; }
      const body = text();
      if (!body) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(body);
      utter.lang = "en-GB";
      utter.rate = 1;
      utter.onend = reset;
      utter.onerror = reset;
      window.speechSynthesis.speak(utter);
      speaking = true;
      btn.classList.add("is-on");
      btn.setAttribute("aria-pressed", "true");
      btn.setAttribute("aria-label", "Stop reading");
    });
    window.addEventListener("pagehide", () => window.speechSynthesis.cancel());
  })();

})();
