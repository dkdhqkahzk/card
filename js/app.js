// =============================================
//  카드섹션 시뮬레이터
//  - 이미지 한 장을 무대 전체에 깔고, 스케치북 부분에서만 보이게 잘라 보여줘요.
//  - 손이 스케치북 가장자리를 가려서 그림이 띄엄띄엄 보이는 모습을 표현해요.
// =============================================
(function () {
  "use strict";

  const config = window.CARD_CONFIG || {};
  const DEFAULT_ROWS = Array.isArray(config.rows) && config.rows.length ? config.rows.slice() : [6, 5, 6];
  const MIN_PEOPLE = 1;
  const MAX_PEOPLE = 30;
  const MAX_ROWS = 12;

  // 모양 비율 (스케치북 가로 : 세로 = 4 : 3)
  const CARD_RATIO = 4 / 3;
  const ROW_GAP = 0.18;   // 줄 사이 간격 (스케치북 높이 대비)
  const HAND_W = 0.14;    // 손 너비 (스케치북 너비 대비)
  const HAND_H = 0.42;    // 손 높이 (스케치북 높이 대비)

  // ---------- 상태 ----------
  const state = {
    rows: loadRows(),
    frames: [],        // { name, src, img, ok }
    frame: 0,
    songs: [],         // { name, src }
    song: -1,
    fit: "stretch",
    showHands: true,
    packed: false,     // 붙여보기: 간격 없이 모아서 완성된 그림 확인
    layout: null
  };

  // ---------- 요소 ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");
  const stage = $("stage");
  const audio = $("audio");
  const el = {
    songName: $("songName"),
    frameCounter: $("frameCounter"),
    frameSlider: $("frameSlider"),
    audioSlider: $("audioSlider"),
    timeNow: $("timeNow"),
    timeTotal: $("timeTotal"),
    btnPlay: $("btnPlay"),
    rowControls: $("rowControls"),
    emptyMsg: $("emptyMsg"),
    modal: $("manageModal"),
    audioModal: $("audioModal"),
    imageList: $("imageList"),
    audioList: $("audioList")
  };

  // ---------- 저장 (인원 설정만 브라우저에 기억) ----------
  function loadRows() {
    try {
      const saved = JSON.parse(localStorage.getItem("cardsection.rows"));
      if (Array.isArray(saved) && saved.length && saved.every((n) => Number.isInteger(n) && n > 0)) return saved;
    } catch (e) { /* 무시 */ }
    return DEFAULT_ROWS.slice();
  }
  function saveRows() {
    try { localStorage.setItem("cardsection.rows", JSON.stringify(state.rows)); } catch (e) { /* 무시 */ }
  }

  // ---------- 파일 불러오기 ----------
  function fileName(path) {
    return decodeURIComponent(String(path).split("/").pop());
  }

  function addFrame(name, src) {
    const frame = { name, src, img: new Image(), ok: false };
    frame.img.onload = () => { frame.ok = true; draw(); renderImageList(); };
    frame.img.onerror = () => { frame.ok = false; frame.failed = true; renderImageList(); };
    frame.img.src = src;
    state.frames.push(frame);
  }

  function addSong(name, src) {
    state.songs.push({ name, src });
    if (state.song < 0) selectSong(0);
  }

  function selectSong(i) {
    if (i < 0 || i >= state.songs.length) {
      state.song = -1;
      audio.removeAttribute("src");
      audio.load();
    } else {
      state.song = i;
      audio.src = state.songs[i].src;
      audio.load();
    }
    updateInfo();
    updatePlayButton();
    renderAudioList();
  }

  (config.images || []).forEach((p) => addFrame(fileName(p), p));
  (config.audio || []).forEach((p) => addSong(fileName(p), p));

  $("inputImages").addEventListener("change", (e) => {
    const files = Array.from(e.target.files).sort((a, b) =>
      a.name.localeCompare(b.name, "ko", { numeric: true }));
    const firstNew = state.frames.length;
    files.forEach((f) => addFrame(f.name, URL.createObjectURL(f)));
    if (files.length) goTo(firstNew);
    e.target.value = "";
    renderImageList();
  });

  function onAudioFiles(e) {
    const files = Array.from(e.target.files);
    const firstNew = state.songs.length;
    files.forEach((f) => state.songs.push({ name: f.name, src: URL.createObjectURL(f) }));
    if (files.length) selectSong(firstNew);
    e.target.value = "";
  }
  $("inputAudio").addEventListener("change", onAudioFiles);
  $("inputAudio2").addEventListener("change", onAudioFiles);

  // ---------- 배치 계산 ----------
  function computeLayout(W, H) {
    const rows = state.rows;
    const n = rows.length;
    const maxCount = Math.max(...rows);
    const padX = 40, padRight = 160, padY = 28;

    const availW = W - padX - padRight;
    const availH = H - padY * 2;
    const rowGap = state.packed ? 0 : ROW_GAP;
    const heightUnits = (n + (n - 1) * rowGap) / CARD_RATIO; // 스케치북 너비 1 기준 전체 높이
    let cw = Math.min(availW / (maxCount + HAND_W), availH / heightUnits);
    cw = Math.max(cw, 10);
    const ch = cw / CARD_RATIO;
    const gap = ch * rowGap;
    const totalH = n * ch + (n - 1) * gap;
    const cx = padX + availW / 2;
    const top = (H - totalH) / 2;

    const cards = [];
    const rowInfo = [];
    rows.forEach((count, r) => {
      const y = top + r * (ch + gap);
      const x0 = cx - (count * cw) / 2;
      // px, py: 간격 없이 모았을 때의 위치 (그림을 나누는 기준)
      const px0 = ((maxCount - count) / 2) * cw;
      for (let i = 0; i < count; i++) {
        cards.push({ x: x0 + i * cw, y, w: cw, h: ch, row: r, px: px0 + i * cw, py: r * ch });
      }
      rowInfo.push({ y, cy: y + ch / 2, count });
    });

    // 화면에 보이는 전체 영역
    const box = { x: cx - (maxCount * cw) / 2, y: top, w: maxCount * cw, h: totalH };
    // 간격 없이 모았을 때의 전체 영역 (그림은 여기에 맞춰서 나눠요)
    const packedBox = { x: 0, y: 0, w: maxCount * cw, h: n * ch };
    return { cards, rowInfo, box, packedBox, cw, ch, ctrlX: box.x + box.w + cw * HAND_W + 14 };
  }

  function imageRect(img, box) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (state.fit === "stretch" || !iw || !ih) return { ...box };
    const scale = state.fit === "cover"
      ? Math.max(box.w / iw, box.h / ih)
      : Math.min(box.w / iw, box.h / ih);
    const w = iw * scale, h = ih * scale;
    return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
  }

  // ---------- 그리기 ----------
  function resize() {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.layout = computeLayout(rect.width, rect.height);
    renderRowControls();
    draw();
  }

  function draw() {
    const L = state.layout;
    if (!L) return;
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, W, H);

    const frame = state.frames[state.frame];

    // 1) 그림을 스케치북 수만큼 조각내서 한 장씩 붙이기
    //    줄 간격이 있어도 그림이 잘려 사라지지 않고, 모으면 하나로 이어져요.
    const r = frame && frame.ok ? imageRect(frame.img, L.packedBox) : null;
    if (state.packed) {
      // 붙여보기: 한 번에 그려서 조각 사이에 실선이 생기지 않게 해요
      ctx.save();
      ctx.beginPath();
      L.cards.forEach((c) => ctx.rect(c.x, c.y, c.w, c.h));
      ctx.clip();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(L.box.x, L.box.y, L.box.w, L.box.h);
      if (r) ctx.drawImage(frame.img, L.box.x + r.x, L.box.y + r.y, r.w, r.h);
      ctx.restore();
    } else L.cards.forEach((c) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(c.x, c.y, c.w, c.h);
      ctx.clip();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(c.x, c.y, c.w, c.h);
      if (r) ctx.drawImage(frame.img, c.x - c.px + r.x, c.y - c.py + r.y, r.w, r.h);
      ctx.restore();
    });

    // 2) 스케치북 테두리와 가운데 접힌 선 (붙여보기에서는 숨겨요)
    const lw = Math.max(1, L.cw * 0.012);
    if (!state.packed) L.cards.forEach((c) => {
      ctx.strokeStyle = "rgba(0,0,0,.55)";
      ctx.lineWidth = lw;
      ctx.strokeRect(c.x + lw / 2, c.y + lw / 2, c.w - lw, c.h - lw);
      ctx.strokeStyle = "rgba(0,0,0,.28)";
      ctx.beginPath();
      ctx.moveTo(c.x + c.w / 2, c.y + 2);
      ctx.lineTo(c.x + c.w / 2, c.y + c.h - 2);
      ctx.stroke();
    });

    // 3) 손 (스케치북 양쪽 가장자리를 가려요)
    if (state.showHands && !state.packed) {
      const hw = L.cw * HAND_W, hh = L.ch * HAND_H;
      L.cards.forEach((c) => {
        const cy = c.y + c.h * 0.52;
        drawHand(c.x + hw * 0.4, cy, hw / 2, hh / 2);
        drawHand(c.x + c.w - hw * 0.4, cy, hw / 2, hh / 2);
      });
    }

    el.emptyMsg.hidden = state.frames.length > 0;
  }

  function drawHand(x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#f2c9a4";
    ctx.fill();
    ctx.lineWidth = Math.max(1, rx * 0.12);
    ctx.strokeStyle = "#7a4e33";
    ctx.stroke();
  }

  // ---------- 줄마다 인원 +/− ----------
  function renderRowControls() {
    const L = state.layout;
    el.rowControls.innerHTML = "";
    L.rowInfo.forEach((row, r) => {
      const box = document.createElement("div");
      box.className = "row-ctrl";
      box.style.left = L.ctrlX + "px";
      box.style.top = row.cy + "px";
      box.innerHTML =
        '<button title="인원 추가">＋</button><span>' + row.count + '명</span><button title="인원 삭제">－</button>';
      const [plus, minus] = box.querySelectorAll("button");
      plus.onclick = () => changePeople(r, +1);
      minus.onclick = () => changePeople(r, -1);
      el.rowControls.appendChild(box);
    });
  }

  function changePeople(r, d) {
    const next = state.rows[r] + d;
    if (next < MIN_PEOPLE || next > MAX_PEOPLE) return;
    state.rows[r] = next;
    saveRows();
    resize();
  }

  $("btnAddRow").onclick = () => {
    if (state.rows.length >= MAX_ROWS) return;
    state.rows.push(state.rows[state.rows.length - 1] || 6);
    saveRows(); resize();
  };
  $("btnRemoveRow").onclick = () => {
    if (state.rows.length <= 1) return;
    state.rows.pop();
    saveRows(); resize();
  };
  $("btnResetRows").onclick = () => {
    state.rows = DEFAULT_ROWS.slice();
    saveRows(); resize();
  };

  // ---------- 장면 이동 ----------
  function goTo(i) {
    const n = state.frames.length;
    state.frame = n ? Math.max(0, Math.min(n - 1, i)) : 0;
    updateInfo();
    draw();
    renderImageList();
  }

  $("btnFirst").onclick = () => goTo(0);
  $("btnPrev").onclick = () => goTo(state.frame - 1);
  $("btnNext").onclick = () => goTo(state.frame + 1);
  $("btnLast").onclick = () => goTo(state.frames.length - 1);
  el.frameSlider.addEventListener("input", (e) => goTo(Number(e.target.value) - 1));

  function updateInfo() {
    const n = state.frames.length;
    el.frameCounter.textContent = n ? (state.frame + 1) + " / " + n : "0 / 0";
    el.frameSlider.max = Math.max(1, n);
    el.frameSlider.value = state.frame + 1;
    el.frameSlider.disabled = n <= 1;
    el.songName.textContent = state.song >= 0 ? state.songs[state.song].name : "없음";
  }

  // ---------- 음악 ----------
  function fmt(t) {
    if (!isFinite(t)) t = 0;
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function togglePlay() {
    if (state.song < 0) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function updatePlayButton() {
    el.btnPlay.textContent = audio.paused ? "▶" : "❚❚";
    el.btnPlay.disabled = state.song < 0;
    el.btnPlay.style.opacity = state.song < 0 ? 0.4 : 1;
  }

  el.btnPlay.onclick = togglePlay;
  audio.addEventListener("play", updatePlayButton);
  audio.addEventListener("pause", updatePlayButton);
  audio.addEventListener("ended", updatePlayButton);
  audio.addEventListener("loadedmetadata", () => {
    el.audioSlider.max = audio.duration || 0;
    el.timeTotal.textContent = fmt(audio.duration);
  });
  audio.addEventListener("emptied", () => {
    el.audioSlider.max = 0; el.audioSlider.value = 0;
    el.timeNow.textContent = "0:00"; el.timeTotal.textContent = "0:00";
  });
  audio.addEventListener("timeupdate", () => {
    if (!seeking) el.audioSlider.value = audio.currentTime;
    el.timeNow.textContent = fmt(audio.currentTime);
  });
  let seeking = false;
  el.audioSlider.addEventListener("input", (e) => {
    seeking = true;
    el.timeNow.textContent = fmt(Number(e.target.value));
  });
  el.audioSlider.addEventListener("change", (e) => {
    audio.currentTime = Number(e.target.value);
    seeking = false;
  });

  // ---------- 보기 설정 ----------
  $("fitMode").addEventListener("change", (e) => { state.fit = e.target.value; draw(); });
  $("togglePacked").addEventListener("change", (e) => { state.packed = e.target.checked; resize(); });
  $("toggleHands").addEventListener("change", (e) => { state.showHands = e.target.checked; draw(); });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  $("btnFullscreen").onclick = toggleFullscreen;

  // ---------- 관리 창 ----------
  let openModalEl = null;
  function openModal(m) {
    closeModal();
    openModalEl = m;
    m.hidden = false;
    renderImageList();
    renderAudioList();
  }
  function closeModal() {
    if (openModalEl) openModalEl.hidden = true;
    openModalEl = null;
  }
  $("btnManage").onclick = () => openModal(el.modal);
  $("btnManageAudio").onclick = () => openModal(el.audioModal);
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
    m.querySelector(".modal-close").onclick = closeModal;
  });

  function moveItem(arr, i, d) {
    const j = i + d;
    if (j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return true;
  }

  function renderImageList() {
    if (el.modal.hidden) return;
    el.imageList.innerHTML = "";
    if (!state.frames.length) {
      el.imageList.innerHTML = '<li class="empty">이미지가 없어요</li>';
      return;
    }
    state.frames.forEach((f, i) => {
      const li = document.createElement("li");
      if (i === state.frame) li.className = "active";
      li.innerHTML =
        '<span class="num">' + (i + 1) + '</span>' +
        '<img alt="">' +
        '<span class="name"></span>' +
        '<button title="위로">▲</button><button title="아래로">▼</button><button title="삭제">✕</button>';
      li.querySelector("img").src = f.src;
      li.querySelector(".name").textContent = f.name + (f.failed ? " (불러오기 실패)" : "");
      const [up, down, del] = li.querySelectorAll("button");
      li.onclick = () => goTo(i);
      up.onclick = (e) => {
        e.stopPropagation();
        if (moveItem(state.frames, i, -1)) {
          if (state.frame === i) state.frame--; else if (state.frame === i - 1) state.frame++;
          goTo(state.frame);
        }
      };
      down.onclick = (e) => {
        e.stopPropagation();
        if (moveItem(state.frames, i, 1)) {
          if (state.frame === i) state.frame++; else if (state.frame === i + 1) state.frame--;
          goTo(state.frame);
        }
      };
      del.onclick = (e) => {
        e.stopPropagation();
        state.frames.splice(i, 1);
        goTo(state.frame > i ? state.frame - 1 : state.frame);
      };
      el.imageList.appendChild(li);
    });
  }

  function renderAudioList() {
    if (el.audioModal.hidden) return;
    el.audioList.innerHTML = "";
    if (!state.songs.length) {
      el.audioList.innerHTML = '<li class="empty">음원이 없어요</li>';
      return;
    }
    state.songs.forEach((s, i) => {
      const li = document.createElement("li");
      if (i === state.song) li.className = "active";
      li.innerHTML = '<span class="num">' + (i === state.song ? "♪" : i + 1) + '</span><span class="name"></span>' +
        '<button title="위로">▲</button><button title="아래로">▼</button><button title="삭제">✕</button>';
      li.querySelector(".name").textContent = s.name;
      li.onclick = () => { if (i !== state.song) selectSong(i); };
      const [up, down, del] = li.querySelectorAll("button");
      const move = (d) => (e) => {
        e.stopPropagation();
        if (!moveItem(state.songs, i, d)) return;
        if (state.song === i) state.song += d; else if (state.song === i + d) state.song -= d;
        renderAudioList();
      };
      up.onclick = move(-1);
      down.onclick = move(1);
      del.onclick = (e) => {
        e.stopPropagation();
        const wasCurrent = i === state.song;
        state.songs.splice(i, 1);
        if (wasCurrent) selectSong(state.songs.length ? 0 : -1);
        else { if (state.song > i) state.song--; renderAudioList(); }
      };
      el.audioList.appendChild(li);
    });
  }

  // ---------- 키보드 단축키 ----------
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT") return;
    if (openModalEl && e.key === "Escape") { closeModal(); return; }
    const keys = {
      ArrowRight: () => goTo(state.frame + 1),
      ArrowLeft: () => goTo(state.frame - 1),
      Home: () => goTo(0),
      End: () => goTo(state.frames.length - 1),
      " ": togglePlay,
      f: toggleFullscreen,
      F: toggleFullscreen
    };
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      fn();
    }
  });

  // ---------- 시작 ----------
  new ResizeObserver(resize).observe(stage);
  updateInfo();
  updatePlayButton();
  resize();
})();
