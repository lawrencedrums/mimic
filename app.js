(function(){
  const $ = s => document.querySelector(s);
  const store = {
    get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
    set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  };

  const presetDefaults = { a:{ focus:25, short:5, long:15 }, b:{ focus:45, short:15, long:30 } };
  const defaults = { preset:"a", autoBreak:false, autoFocus:false, autoCheck:false, sound:"chime", volume:70, repeat:1, notify:false, awake:true };
  let settings = loadSettings();
  let tasks = store.get("ft-tasks", []);
  let activeId = store.get("ft-active", null);

  let mode = "focus", round = 1, focusDone = 0;
  let remaining = len("focus") * 60, total = remaining;
  let running = false, endAt = 0, tick = null, wake = null;
  let editingId = null; // null none, "new" new task, or task id

  function loadSettings(){
    const saved = store.get("ft-settings", {});
    const s = Object.assign({}, defaults, saved);
    // Lengths saved before presets existed become the first preset
    const a = saved.focus ? { focus:saved.focus, short:saved.short, long:saved.long } : {};
    s.presets = {
      a: Object.assign({}, presetDefaults.a, a, saved.presets && saved.presets.a),
      b: Object.assign({}, presetDefaults.b, saved.presets && saved.presets.b)
    };
    delete s.focus; delete s.short; delete s.long; delete s.interval;
    return s;
  }
  // Length in minutes of a mode in the current preset
  function len(m){ return settings.presets[settings.preset][m]; }
  const presetLabel = p => settings.presets[p].focus + " · " + settings.presets[p].short;

  const labels = { focus:"Time to focus!", short:"Time for a break!", long:"Time for a long break!" };

  /* ---------- timer ---------- */
  const fmt = s => String(Math.floor(s/60)).padStart(2,"0") + ":" + String(s%60).padStart(2,"0");

  function renderTimer(){
    $("#clock").textContent = fmt(remaining);
    $("#bar").style.width = (total ? (1 - remaining/total) * 100 : 0) + "%";
    const t = activeTask();
    document.title = fmt(remaining) + " – " + (mode === "focus" ? (t ? t.title : "Time to focus!") : "Time for a break!");
    $("#start").textContent = running ? "PAUSE" : "START";
    $("#start").classList.toggle("running", running);
    $("#skip").classList.toggle("show", running);
  }

  function setMode(m, autostart){
    stop();
    mode = m;
    document.body.dataset.mode = m;
    // Tint the installed app's title bar to match the mode colour
    $('meta[name="theme-color"]').content = getComputedStyle(document.body).getPropertyValue("--bg").trim();
    document.querySelectorAll("#modes .mode").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === m));
    total = remaining = len(m) * 60;
    renderStatus(); renderTimer();
    if (autostart) start();
  }

  // Screen wake lock, held only while the timer runs. Browsers drop it
  // whenever the tab is hidden, so it is re-requested on return. The
  // request promise is stored so overlapping calls can't take two locks.
  const canWake = "wakeLock" in navigator;
  let wakeLock = null;
  function holdAwake(){
    if (!canWake || !settings.awake || !running || wakeLock || document.hidden) return;
    const req = wakeLock = navigator.wakeLock.request("screen");
    req.then(l => l.addEventListener("release", () => { if (wakeLock === req) wakeLock = null; }))
      .catch(() => { if (wakeLock === req) wakeLock = null; });
  }
  function releaseAwake(){
    const req = wakeLock;
    wakeLock = null;
    if (req) req.then(l => l.release()).catch(() => {});
  }
  document.addEventListener("visibilitychange", holdAwake);

  function start(){
    if (running) return;
    running = true;
    endAt = Date.now() + remaining * 1000;
    tick = setInterval(step, 250);
    // Hidden tabs throttle repeating timers to as little as once a minute,
    // but a single timeout still fires on time, so the round ends promptly.
    wake = setTimeout(step, remaining * 1000);
    holdAwake();
    click();
    renderTimer();
  }
  function stop(){
    running = false;
    clearInterval(tick); tick = null;
    clearTimeout(wake); wake = null;
    releaseAwake();
    renderTimer();
  }
  function step(){
    const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    if (left !== remaining){ remaining = left; renderTimer(); }
    if (left <= 0) finish(true);
  }

  function finish(natural){
    stop();
    if (natural) chime();
    const ended = mode;
    if (mode === "focus"){
      focusDone++;
      const t = activeTask();
      if (t){
        t.act++;
        if (settings.autoCheck && t.act >= t.est) t.done = true;
        saveTasks();
      }
      round++;
      setMode("short", settings.autoBreak);
    } else {
      setMode("focus", settings.autoFocus);
    }
    if (natural) notify(ended);
    renderTasks();
  }

  $("#start").onclick = () => running ? stop() : start();
  $("#skip").onclick = () => {
    if (confirm("End this round early? The current round won't count fully.")) finish(false);
  };
  document.querySelectorAll("#modes .mode").forEach(b => b.onclick = () => {
    if (b.dataset.mode === mode) return;
    if (running && !confirm("The timer is still running. Switch anyway?")) return;
    setMode(b.dataset.mode, false);
  });

  /* presets share the mode bar's line; the swap button flips between them */
  function showPresets(on){
    $("#modes").hidden = on; $("#presets").hidden = !on;
    $("#swap").setAttribute("aria-expanded", on);
    $("#swap").setAttribute("aria-label", on ? "Back to timer modes" : "Choose preset");
  }
  function renderPresets(){
    document.querySelectorAll("[data-preset]").forEach(b => {
      b.textContent = presetLabel(b.dataset.preset);
      b.setAttribute("aria-pressed", b.dataset.preset === settings.preset);
    });
  }
  $("#swap").onclick = () => showPresets($("#modes").hidden === false);
  document.querySelectorAll("[data-preset]").forEach(b => b.onclick = () => {
    showPresets(false);
    if (b.dataset.preset === settings.preset) return;
    settings.preset = b.dataset.preset;
    store.set("ft-settings", settings);
    renderPresets();
    // A running round keeps its length; the new preset starts next round
    if (!running){ total = remaining = len(mode) * 60; renderTimer(); }
    renderTasks();
  });
  document.addEventListener("keydown", e => {
    if (e.code === "Space" && !e.target.closest("input,textarea,button,dialog")){
      e.preventDefault(); running ? stop() : start();
    }
  });

  /* sounds */
  let actx;
  function tone(freq, at, dur, vol, type){
    try{
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      // iOS suspends the context when the app is backgrounded
      if (actx.state === "suspended") actx.resume();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(Math.max(vol, 0.0001), actx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + at + dur);
      o.connect(g).connect(actx.destination);
      o.start(actx.currentTime + at); o.stop(actx.currentTime + at + dur);
    }catch(e){}
  }
  function click(){ tone(900, 0, .06, .08); }

  // Each alarm is synthesised so the app ships no audio files. `play`
  // schedules one ring starting at `at` and `len` is how long it lasts,
  // which is used to space out repeats.
  const alarms = {
    chime:   { len:1.4, play:(at,v) => [0,.35,.7].forEach((t,i) => tone([880,1100,1320][i], at+t, .6, .25*v)) },
    bell:    { len:2.6, play:(at,v) => [[1,.3],[2,.12],[2.76,.08],[5.4,.04]].forEach(([r,g]) => tone(587*r, at, 2.4/Math.sqrt(r), g*v)) },
    digital: { len:1.2, play:(at,v) => [0,.15,.3,.45].forEach(t => tone(2000, at+t, .09, .08*v, "square")) },
    kitchen: { len:1.6, play:(at,v) => { for (let i = 0; i < 16; i++) tone(2600, at+i*.07, .05, .07*v, "triangle"); } },
    none:    { len:0, play:() => {} }
  };
  function alarm(name, times){
    const a = alarms[name] || alarms.chime;
    const v = settings.volume / 100;
    for (let i = 0; i < times; i++) a.play(i * (a.len + .3), v);
  }
  function chime(){ alarm(settings.sound, settings.repeat); }

  /* notifications */
  const canNotify = "Notification" in window;
  function notify(ended){
    if (!settings.notify || !canNotify || Notification.permission !== "granted") return;
    const t = activeTask();
    const title = ended === "focus" ? "Pomodoro done" : "Break over";
    const body = mode === "focus" && t ? "Next up: " + t.title : labels[mode];
    const opts = { body, tag:"mimic", renotify:true, icon:"icons/icon-192.png" };
    // Android Chrome only allows notifications shown through the service worker
    (navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : Promise.resolve())
      .then(reg => reg ? reg.showNotification(title, opts) : new Notification(title, opts))
      .catch(() => {});
  }

  /* ---------- tasks ---------- */
  const uid = () => Math.random().toString(36).slice(2,10);
  const activeTask = () => tasks.find(t => t.id === activeId) || null;
  function saveTasks(){ store.set("ft-tasks", tasks); store.set("ft-active", activeId); }

  function renderStatus(){
    $("#count").textContent = "#" + round;
    const t = activeTask();
    $("#now").textContent = mode === "focus" && t ? t.title : labels[mode];
  }

  const esc = s => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const grip_svg = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
  const tick_svg = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  const stepper = (id, val, min, what) => `<span class="stepper">
    <button type="button" class="step" data-for="${id}" data-dir="-1" aria-label="Decrease ${what}">&minus;</button>
    <input class="num" type="number" min="${min}" id="${id}" value="${val}" aria-label="${what[0].toUpperCase() + what.slice(1)}">
    <button type="button" class="step" data-for="${id}" data-dir="1" aria-label="Increase ${what}">+</button>
  </span>`;

  function editorHTML(t){
    const isNew = !t;
    t = t || { title:"", est:1, act:0, note:"" };
    return `<div class="editor" id="editor">
      <div class="body">
        <input type="text" id="edTitle" placeholder="What are you working on?" value="${esc(t.title)}" aria-label="Task name">
        ${isNew ? "" : `<label for="edAct">Pomodoros done / estimated</label>`}
        ${isNew ? `<label for="edEst">Estimated pomodoros</label>` : ""}
        <div class="est">
          ${isNew ? "" : `${stepper("edAct", t.act, 0, "pomodoros done")} <span>/</span>`}
          ${stepper("edEst", t.est, 1, "estimated pomodoros")}
        </div>
        <div id="noteWrap">${t.note ? `<label for="edNote">Note</label><textarea id="edNote">${esc(t.note)}</textarea>` : `<button class="linky" id="addNote" type="button">+ Add note</button>`}</div>
      </div>
      <footer>
        ${isNew ? "" : `<button class="btn danger" id="edDelete">Delete</button>`}
        <span class="spacer"></span>
        <button class="btn plain" id="edCancel">Cancel</button>
        <button class="btn dark" id="edSave">Save</button>
      </footer>
    </div>`;
  }

  function wireEditor(){
    const title = $("#edTitle"), save = $("#edSave");
    const sync = () => save.disabled = !title.value.trim();
    title.oninput = sync; sync();
    title.focus();
    title.onkeydown = e => { if (e.key === "Enter" && title.value.trim()) commit(); if (e.key === "Escape") closeEditor(); };
    const an = $("#addNote");
    if (an) an.onclick = () => { $("#noteWrap").innerHTML = `<label for="edNote">Note</label><textarea id="edNote"></textarea>`; $("#edNote").focus(); };
    document.querySelectorAll("#editor .step").forEach(b => b.onclick = () => {
      const input = $("#" + b.dataset.for);
      if (b.dataset.dir > 0) input.stepUp(); else input.stepDown();
    });
    $("#edCancel").onclick = closeEditor;
    save.onclick = commit;
    const del = $("#edDelete");
    if (del) del.onclick = () => {
      tasks = tasks.filter(t => t.id !== editingId);
      if (activeId === editingId) activeId = null;
      saveTasks(); closeEditor();
    };
  }

  function commit(){
    const title = $("#edTitle").value.trim();
    if (!title) return;
    const est = Math.max(1, parseInt($("#edEst").value) || 1);
    const note = $("#edNote") ? $("#edNote").value.trim() : "";
    if (editingId === "new"){
      const t = { id:uid(), title, est, act:0, note, done:false };
      tasks.push(t);
      if (!activeId) activeId = t.id;
    } else {
      const t = tasks.find(x => x.id === editingId);
      if (t){
        t.title = title; t.est = est; t.note = note;
        const a = parseInt($("#edAct").value);
        if (!isNaN(a) && a >= 0) t.act = a;
      }
    }
    saveTasks(); closeEditor();
  }
  function closeEditor(){ editingId = null; renderTasks(); }

  function renderTasks(){
    const list = $("#list");
    list.innerHTML = tasks.map(t => {
      if (t.id === editingId) return `<li>${editorHTML(t)}</li>`;
      return `<li class="task${t.id === activeId ? " active" : ""}${t.done ? " done" : ""}" data-id="${t.id}" tabindex="0" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">
        <span class="grip" data-grip title="Drag to reorder" aria-hidden="true">${grip_svg}</span>
        <button class="check" data-check aria-label="${t.done ? "Mark as not done" : "Mark as done"}">${tick_svg}</button>
        <span class="title">${esc(t.title)}${t.note ? `<span class="note">${esc(t.note)}</span>` : ""}</span>
        <span class="pomos"><b>${t.act}</b>/${t.est}</span>
        <button class="icon-btn" data-edit aria-label="Edit task"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
      </li>`;
    }).join("");

    $("#addSlot").innerHTML = editingId === "new" ? editorHTML(null)
      : `<button class="add" id="addBtn"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add task</button>`;
    if (editingId) wireEditor();
    const ab = $("#addBtn"); if (ab) ab.onclick = () => { editingId = "new"; renderTasks(); };

    renderSummary(); renderStatus(); renderTimer();
  }

  $("#list").addEventListener("click", e => {
    const li = e.target.closest(".task"); if (!li || e.target.closest("[data-grip]")) return;
    const t = tasks.find(x => x.id === li.dataset.id); if (!t) return;
    if (e.target.closest("[data-check]")){ t.done = !t.done; }
    else if (e.target.closest("[data-edit]")){ editingId = t.id; }
    else { activeId = t.id; }
    saveTasks(); renderTasks();
  });
  $("#list").addEventListener("keydown", e => {
    const li = e.target.closest(".task");
    if (li && e.target === li && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); activeId = li.dataset.id; saveTasks(); renderTasks(); }
    // Alt+Up/Down moves the focused task
    if (li && e.target === li && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")){
      e.preventDefault();
      const i = tasks.findIndex(t => t.id === li.dataset.id), j = i + (e.key === "ArrowUp" ? -1 : 1);
      if (i < 0 || j < 0 || j >= tasks.length) return;
      tasks.splice(j, 0, tasks.splice(i, 1)[0]);
      saveTasks(); renderTasks();
      const moved = $(`#list .task[data-id="${li.dataset.id}"]`); if (moved) moved.focus();
    }
  });

  /* drag to reorder */
  // Pointer events rather than HTML5 drag and drop, which touch screens
  // don't support well. While dragging, the picked-up task follows the
  // pointer and the others slide aside; on release the node is moved and
  // the task order is read back from the list.
  let drag = null;
  $("#list").addEventListener("pointerdown", e => {
    const grip = e.target.closest("[data-grip]");
    if (!grip || drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    const list = $("#list"), li = grip.closest(".task");
    const items = [...list.children];
    const rects = items.map(el => el.getBoundingClientRect());
    const from = items.indexOf(li);
    drag = {
      li, items, rects, from, to:from, id:e.pointerId,
      startY:e.clientY + scrollY, y:e.clientY, raf:0,
      size:rects[from].height + parseFloat(getComputedStyle(li).marginBottom)
    };
    grip.setPointerCapture(e.pointerId);
    list.classList.add("sorting");
    li.classList.add("dragging");
    drag.raf = requestAnimationFrame(autoScroll);
  });
  $("#list").addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.y = e.clientY;
    layoutDrag();
  });
  $("#list").addEventListener("pointerup", e => endDrag(e, true));
  $("#list").addEventListener("pointercancel", e => endDrag(e, false));

  function layoutDrag(){
    const { li, items, rects, from, size } = drag;
    const dy = drag.y + scrollY - drag.startY;
    li.style.transform = `translateY(${dy}px)`;
    const mid = rects[from].top + rects[from].height / 2 + dy;
    let to = 0;
    rects.forEach((r, i) => { if (i !== from && r.top + r.height / 2 < mid) to++; });
    drag.to = to;
    items.forEach((el, i) => {
      if (el === li) return;
      const shift = from < to && i > from && i <= to ? -size : to < from && i >= to && i < from ? size : 0;
      el.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  }

  // Scroll the page while the pointer is held near the top or bottom edge
  function autoScroll(){
    if (!drag) return;
    const edge = 60, h = innerHeight;
    const v = drag.y < edge ? -(edge - drag.y) / 4 : drag.y > h - edge ? (drag.y - (h - edge)) / 4 : 0;
    if (v){ scrollBy(0, v); layoutDrag(); }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function endDrag(e, drop){
    if (!drag || e.pointerId !== drag.id) return;
    const { li, items, from, to } = drag;
    cancelAnimationFrame(drag.raf);
    drag = null;
    const list = $("#list");
    list.classList.remove("sorting");
    li.classList.remove("dragging");
    items.forEach(el => el.style.transform = "");
    if (!drop || to === from) return;
    const rest = items.filter(el => el !== li);
    list.insertBefore(li, rest[to] || null);
    // The open editor's row has no data-id; it stands for the task being edited
    const order = [...list.children].map(el => el.dataset.id || editingId);
    tasks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    saveTasks();
  }

  function renderSummary(){
    const open = tasks.filter(t => !t.done);
    const box = $("#summary");
    if (!tasks.length){ box.hidden = true; return; }
    const est = tasks.reduce((a,t) => a + t.est, 0);
    const act = tasks.reduce((a,t) => a + Math.min(t.act, t.est), 0);
    const left = open.reduce((a,t) => a + Math.max(0, t.est - t.act), 0);
    // remaining focus time + breaks between them
    const mins = left * len("focus") + Math.max(0, left - 1) * len("short");
    const fin = new Date(Date.now() + mins * 60000);
    const hm = fin.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    const h = (mins / 60).toFixed(1);
    box.hidden = false;
    box.innerHTML = `Pomos: <b>${act}</b> / <b>${est}</b> &nbsp; Finish at: <b>${left ? hm : "—"}</b>${left ? ` (${h}h)` : ""}`;
  }
  setInterval(() => { if (tasks.length) renderSummary(); }, 30000);

  /* task menu */
  const menu = $("#menu"), menuBtn = $("#menuBtn");
  menuBtn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; menuBtn.setAttribute("aria-expanded", !menu.hidden); };
  document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target)){ menu.hidden = true; menuBtn.setAttribute("aria-expanded", false); } });
  menu.addEventListener("click", e => {
    const act = e.target.dataset.act; if (!act) return;
    if (act === "clear-done") tasks = tasks.filter(t => !t.done);
    if (act === "clear-act") tasks.forEach(t => t.act = 0);
    if (act === "clear-all" && confirm("Delete every task?")) tasks = [];
    if (!tasks.find(t => t.id === activeId)) activeId = null;
    menu.hidden = true; saveTasks(); renderTasks();
  });

  /* ---------- settings ---------- */
  const dlg = $("#settings");
  $("#openSettings").onclick = () => {
    draft = JSON.parse(JSON.stringify(settings.presets));
    editPreset(settings.preset);
    $("#setAutoBreak").checked = settings.autoBreak; $("#setAutoFocus").checked = settings.autoFocus; $("#setAutoCheck").checked = settings.autoCheck;
    $("#setNotify").checked = settings.notify && canNotify && Notification.permission === "granted";
    $("#notifyHint").hidden = true;
    $("#setAwake").checked = settings.awake;
    $("#setSound").value = settings.sound; $("#setVolume").value = settings.volume; $("#setRepeat").value = settings.repeat;
    dlg.showModal();
  };
  // Lengths are edited per preset; unsaved edits for both live in `draft`
  let draft, editing;
  const lenFields = { focus:"#setFocus", short:"#setShort", long:"#setLong" };
  const lenLimits = { focus:180, short:60, long:120 };
  function readLengths(){
    for (const m in lenFields) draft[editing][m] = Math.min(lenLimits[m], Math.max(1, parseInt($(lenFields[m]).value) || draft[editing][m]));
  }
  function editPreset(p){
    editing = p;
    for (const m in lenFields) $(lenFields[m]).value = draft[p][m];
    document.querySelectorAll("[data-edit]").forEach(b => {
      b.textContent = draft[b.dataset.edit].focus + " · " + draft[b.dataset.edit].short;
      b.setAttribute("aria-pressed", b.dataset.edit === p);
    });
  }
  document.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { readLengths(); editPreset(b.dataset.edit); });
  $("#closeSettings").onclick = () => dlg.close();
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
  // Preview with the unsaved values so you can audition before saving
  const preview = () => {
    const saved = settings.volume;
    settings.volume = parseInt($("#setVolume").value) || 0;
    alarm($("#setSound").value, 1);
    settings.volume = saved;
  };
  $("#setSound").onchange = preview;
  $("#setVolume").onchange = preview;
  $("#testSound").onclick = preview;
  if (!canNotify) $("#notifyRow").hidden = true;
  if (!canWake) $("#awakeRow").hidden = true;
  $("#setNotify").onchange = e => {
    if (!e.target.checked || Notification.permission === "granted") return;
    Notification.requestPermission().then(p => {
      if (p === "granted") return;
      e.target.checked = false;
      $("#notifyHint").textContent = p === "denied" ? "Blocked in your browser's site settings" : "Allow notifications to turn this on";
      $("#notifyHint").hidden = false;
    });
  };
  $("#saveSettings").onclick = () => {
    const n = (id, lo, hi, d) => Math.min(hi, Math.max(lo, parseInt($(id).value) || d));
    const old = len(mode);
    readLengths();
    settings = {
      presets:draft, preset:settings.preset,
      autoBreak:$("#setAutoBreak").checked, autoFocus:$("#setAutoFocus").checked, autoCheck:$("#setAutoCheck").checked,
      sound:$("#setSound").value, volume:Math.min(100, Math.max(0, parseInt($("#setVolume").value) || 0)), repeat:n("#setRepeat",1,10,1),
      notify:$("#setNotify").checked,
      awake:$("#setAwake").checked
    };
    store.set("ft-settings", settings);
    dlg.close();
    settings.awake ? holdAwake() : releaseAwake();
    if (!running && len(mode) !== old){ total = remaining = len(mode) * 60; renderTimer(); }
    renderPresets(); renderTasks();
  };

  renderPresets();
  setMode("focus", false);
  renderTasks();
})();
