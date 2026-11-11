// app.js — Study Hub logic.
// Reading order: 1 state, 2 helpers, 3 planner, 4-8 one render function per tab, 9 startup.

(function () {
  const COURSES = window.COURSES;

  // ---------- 1. State (saved in localStorage) ----------
  const KEY = "study-hub-v2";
  const DEFAULTS = {
    done: {},          // { courseId: [sessionNumbers] }
    wrong: {},         // { courseId: { sessionNumber: missCount } }
    best: {},          // { courseId: bestQuizScore }
    scope: {},         // { courseId: highest session number the midterm covers }
    examDate: "2026-11-15",
    examType: "unconfirmed",
    current: COURSES[0].id,
    fontScale: 1,      // reader text size
    lastRead: {},      // { courseId: last opened session }
  };

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && typeof saved === "object") return Object.assign({}, DEFAULTS, saved);
    } catch (e) { /* private mode etc. */ }
    return Object.assign({}, DEFAULTS);
  }
  const progress = load();
  if (!COURSES.some((c) => c.id === progress.current)) progress.current = COURSES[0].id;

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ }
  }

  let tab = "home";
  let quiz = null;
  let quizMode = "all";
  let deck = [];
  let cardIndex = 0;
  let showingBack = false;

  // ---------- 2. Helpers ----------
  const view = document.getElementById("view");
  const courseById = (id) => COURSES.find((c) => c.id === id);
  const current = () => courseById(progress.current);
  const scopeOf = (c) => progress.scope[c.id] || c.sessions.length;
  const doneList = (c) => progress.done[c.id] || [];
  const isDone = (c, n) => doneList(c).includes(n);

  function toggleDone(c, n, on) {
    const list = doneList(c).filter((x) => x !== n);
    if (on) list.push(n);
    progress.done[c.id] = list;
    save();
    updateChip();
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function parseDate(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function startOfToday() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function daysLeft() {
    return Math.round((parseDate(progress.examDate) - startOfToday()) / 86400000);
  }
  function fmtDate(d) {
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  function scopedSessions(c) {
    const limit = scopeOf(c);
    return c.sessions.filter((s) => s.n <= limit);
  }

  function updateChip() {
    let total = 0, done = 0;
    COURSES.forEach((c) => {
      scopedSessions(c).forEach((s) => { total++; if (isDone(c, s.n)) done++; });
    });
    const pct = total ? Math.round((done / total) * 100) : 0;
    document.getElementById("progress-text").textContent = `${done}/${total} sessions revised (${pct}%)`;
    document.getElementById("progress-fill").style.width = pct + "%";
  }

  function weakList() {
    const out = [];
    COURSES.forEach((c) => {
      const w = progress.wrong[c.id] || {};
      Object.keys(w).forEach((n) => {
        if (w[n] > 0) {
          const s = c.sessions.find((x) => x.n === Number(n));
          if (s) out.push({ c, s, count: w[n] });
        }
      });
    });
    return out.sort((a, b) => b.count - a.count);
  }

  // ---------- 3. Revision planner ----------
  // Interleave unfinished, in-scope sessions across courses, then spread over the days left.
  function buildPlan() {
    const queues = COURSES.map((c) =>
      scopedSessions(c).filter((s) => !isDone(c, s.n)).map((s) => ({ c, s }))
    );
    const items = [];
    let more = true;
    while (more) {
      more = false;
      queues.forEach((q) => {
        if (q.length) { items.push(q.shift()); more = true; }
      });
    }
    const days = Math.max(1, daysLeft() + 1); // today counts as a study day
    const perDay = Math.max(1, Math.ceil(items.length / days));
    const plan = [];
    for (let i = 0; i < items.length; i += perDay) {
      plan.push(items.slice(i, i + perDay));
    }
    return { plan, perDay, total: items.length };
  }

  // ---------- 4. Home ----------
  const EXAM_TIPS = {
    unconfirmed: "Format not confirmed yet. Set it below once you know. Until then, the quiz and flashcards cover both cases.",
    online: "Online test (CMA): mostly multiple choice. Use the Quiz tab daily and drill your weak topics.",
    assignment: "Assignment (TMA): written work. Use the Learn notes for structure, and leave time to write and proofread before the deadline.",
  };

  function renderHome() {
    const left = daysLeft();
    const exam = parseDate(progress.examDate);
    const { plan, perDay, total } = buildPlan();
    const today = plan[0] || [];

    const countdown = left >= 0
      ? `<div class="big">${left}</div><div class="sub">${left === 1 ? "day" : "days"} to midterms · ${fmtDate(exam)}</div>`
      : `<div class="big">Done</div><div class="sub">The date you set (${fmtDate(exam)}) has passed. Update it below.</div>`;

    const todayHtml = total === 0
      ? `<p>Everything in scope is ticked off. Use the Quiz tab to keep sharp.</p>`
      : `<p class="hint">About ${perDay} session${perDay > 1 ? "s" : ""} a day gets you through ${total} remaining before the deadline.</p>` +
        today.map(({ c, s }) => `
          <label class="row">
            <input type="checkbox" data-c="${c.id}" data-n="${s.n}" />
            <div><div class="badge">${c.code} · Session ${s.n}</div><div class="t">${s.title}</div></div>
          </label>`).join("");

    const courseCards = COURSES.map((c) => {
      const sc = scopedSessions(c);
      const d = sc.filter((s) => isDone(c, s.n)).length;
      const pct = sc.length ? Math.round((d / sc.length) * 100) : 0;
      return `
        <div class="card course-card" data-go="${c.id}">
          <div class="badge">${c.code}</div>
          <div class="t">${c.title}</div>
          <div class="meta">${d}/${sc.length} sessions in scope revised</div>
          <div class="bar"><div style="width:${pct}%"></div></div>
        </div>`;
    }).join("");

    const weak = weakList().slice(0, 5);
    const weakHtml = weak.length
      ? `<div class="card"><h3>Weak topics</h3><p class="hint">From quiz mistakes. Get them right to clear them.</p>` +
        weak.map((w) => `<div class="row"><div><div class="badge">${w.c.code} · Session ${w.s.n}</div><div class="t">${w.s.title}</div><div class="sub-t">${w.count} miss${w.count > 1 ? "es" : ""}</div></div></div>`).join("") +
        `<button class="btn" id="drill">Drill weak topics</button></div>`
      : "";

    const scopeInputs = COURSES.map((c) => `
      <label>${c.code} covers sessions 1 to
        <input type="number" min="1" max="${c.sessions.length}" value="${scopeOf(c)}" data-scope="${c.id}" />
      </label>`).join("");

    view.innerHTML = `
      <div class="card countdown">
        <h2>Midterm countdown</h2>
        ${countdown}
        <div class="tip" style="color:var(--text)">${EXAM_TIPS[progress.examType]}</div>
      </div>
      <div class="card">
        <h3>Today's focus</h3>
        ${todayHtml}
      </div>
      ${weakHtml}
      <h3 style="margin:18px 4px 8px">Your courses</h3>
      ${courseCards}
      <div class="card settings">
        <h3>Midterm settings</h3>
        <label>Midterm date <input type="date" id="exam-date" value="${progress.examDate}" /></label>
        <label>Format
          <select id="exam-type">
            <option value="unconfirmed" ${progress.examType === "unconfirmed" ? "selected" : ""}>Not confirmed yet</option>
            <option value="online" ${progress.examType === "online" ? "selected" : ""}>Online test</option>
            <option value="assignment" ${progress.examType === "assignment" ? "selected" : ""}>Assignment</option>
          </select>
        </label>
        <p class="hint">What does each midterm cover? Set the last session for each course. Defaults to the full course.</p>
        ${scopeInputs}
      </div>`;

    view.querySelectorAll(".row input[type=checkbox]").forEach((box) => {
      box.addEventListener("change", () => {
        toggleDone(courseById(box.dataset.c), Number(box.dataset.n), box.checked);
        renderHome();
      });
    });
    view.querySelectorAll("[data-go]").forEach((el) => {
      el.addEventListener("click", () => { progress.current = el.dataset.go; save(); showTab("plan"); });
    });
    document.getElementById("exam-date").addEventListener("change", (e) => {
      if (e.target.value) { progress.examDate = e.target.value; save(); renderHome(); }
    });
    document.getElementById("exam-type").addEventListener("change", (e) => {
      progress.examType = e.target.value; save(); renderHome();
    });
    view.querySelectorAll("[data-scope]").forEach((inp) => {
      inp.addEventListener("change", () => {
        const c = courseById(inp.dataset.scope);
        const v = Math.min(c.sessions.length, Math.max(1, Number(inp.value) || c.sessions.length));
        progress.scope[c.id] = v; save(); updateChip(); renderHome();
      });
    });
    const drill = document.getElementById("drill");
    if (drill) drill.addEventListener("click", () => {
      progress.current = weak[0].c.id; save(); quizMode = "weak"; quiz = null; showTab("quiz");
    });
  }

  // ---------- 5. Plan ----------
  function renderPlan() {
    const c = current();
    const limit = scopeOf(c);
    const rows = c.sessions.map((s) => `
      <label class="row ${isDone(c, s.n) ? "done" : ""} ${s.n > limit ? "dim" : ""}">
        <input type="checkbox" data-n="${s.n}" ${isDone(c, s.n) ? "checked" : ""} />
        <div>
          <div class="badge">Session ${s.n}${s.n > limit ? '<span class="pill">outside midterm scope</span>' : ""}</div>
          <div class="t">${s.title}</div>
        </div>
      </label>`).join("");

    const { plan } = buildPlan();
    const days = plan.map((items, i) => {
      const d = new Date(startOfToday().getTime() + i * 86400000);
      return `<details class="session" ${i === 0 ? "open" : ""}><summary>${i === 0 ? "Today" : fmtDate(d)}</summary><ul>` +
        items.map(({ c: cc, s }) => `<li>${cc.code}: ${s.title}</li>`).join("") + `</ul></details>`;
    }).join("");

    view.innerHTML = `
      <div class="card">
        <h2>${c.code}: ${c.title}</h2>
        <p>${c.blurb}</p>
        <div class="grid">
          <div class="stat"><b>${c.credit}</b><span>Credit units</span></div>
          <div class="stat"><b>${c.sessions.length}</b><span>Study sessions</span></div>
          <div class="stat"><b>${limit}</b><span>Sessions in midterm scope</span></div>
        </div>
        ${c.marking.length ? `<p class="hint" style="margin-top:12px">Grading: ${c.marking.map((m) => `${m.label} ${m.marks}%`).join(" · ")}</p>` : ""}
      </div>
      <div class="card">
        <h3>Tick sessions as you revise them</h3>
        ${rows}
      </div>
      <div class="card">
        <h3>Revision schedule (all courses)</h3>
        <p class="hint">Spreads what is left across the days to your midterm date, mixing courses.</p>
        ${days || "<p>Nothing left to schedule.</p>"}
      </div>`;

    view.querySelectorAll(".row input[type=checkbox]").forEach((box) => {
      box.addEventListener("change", () => {
        toggleDone(c, Number(box.dataset.n), box.checked);
        box.closest(".row").classList.toggle("done", box.checked);
      });
    });
  }

  // ---------- 6. Learn (full reader) ----------
  // Notes are bundled by build-content.js into content/<id>.js:
  //   window.CONTENT[courseId] = { note: "...", sessions: { 1: "<html>", 2: "<html>" } }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function contentFor(c) {
    return (window.CONTENT && window.CONTENT[c.id]) || null;
  }
  function htmlFor(c, n) {
    const k = contentFor(c);
    return (k && k.sessions && k.sessions[n]) || null;
  }
  function readMinutes(html) {
    const words = (html.replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<[^>]+>/g, " ").match(/\S+/g) || []).length;
    return Math.max(1, Math.round(words / 200));
  }

  let learnSession = null; // null = session list, number = reading that session

  function openSession(n) {
    learnSession = n;
    renderLearn();
    window.scrollTo({ top: 0 });
  }

  function renderLearn() {
    const c = current();
    if (learnSession != null && c.sessions.some((s) => s.n === learnSession)) return renderReader(c, learnSession);
    learnSession = null;

    const k = contentFor(c);
    const limit = scopeOf(c);
    const last = progress.lastRead && progress.lastRead[c.id];
    const rows = c.sessions.map((s) => {
      const html = htmlFor(c, s.n);
      return `
        <button class="read-row ${s.n > limit ? "dim" : ""}" data-open="${s.n}">
          <span class="read-num">${s.n}</span>
          <span class="read-main">
            <span class="t">${esc(s.title)}</span>
            <span class="sub-t">${html ? readMinutes(html) + " min read" : "Quick notes"}${isDone(c, s.n) ? " · revised ✓" : ""}${s.n > limit ? " · outside midterm scope" : ""}</span>
          </span>
          <span class="read-go">›</span>
        </button>`;
    }).join("");

    view.innerHTML = `
      <div class="card">
        <h2>${c.code} study notes</h2>
        <p class="hint">${k && k.note ? esc(k.note) : "Full reading notes. Pick a session to read."}</p>
        ${last ? `<button class="btn" data-open="${last}">Continue: Session ${last}</button>` : ""}
      </div>
      <div class="card readlist">${rows}</div>`;
    view.querySelectorAll("[data-open]").forEach((el) => {
      el.addEventListener("click", () => openSession(Number(el.dataset.open)));
    });
  }

  function renderReader(c, n) {
    const s = c.sessions.find((x) => x.n === n);
    let html = htmlFor(c, n);
    progress.lastRead = progress.lastRead || {};
    progress.lastRead[c.id] = n;
    save();

    const idx = c.sessions.findIndex((x) => x.n === n);
    const prev = c.sessions[idx - 1];
    const next = c.sessions[idx + 1];
    const scale = progress.fontScale || 1;

    const quick = `
      <details class="session quickrev">
        <summary>Quick revision</summary>
        <p>${esc(s.summary)}</p>
        <ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
        ${s.example ? `<div class="tip"><b>Example:</b> ${esc(s.example)}</div>` : ""}
      </details>`;

    if (html) {
      html = html.replace('<ul class="objectives"', '<h4 class="obj-h">By the end of this session you should be able to</h4><ul class="objectives"');
    }
    const body = html
      ? `<div class="notes">${html}</div>`
      : `<p class="hint">Full notes for this session are not added yet. Use the quick revision above.</p>`;

    view.innerHTML = `
      <div class="reader-bar">
        <button class="btn secondary" id="back-list">‹ Sessions</button>
        <span>
          <button class="btn secondary" id="fs-down" aria-label="Smaller text">A−</button>
          <button class="btn secondary" id="fs-up" aria-label="Larger text">A+</button>
        </span>
      </div>
      <article class="card reader" id="reader" style="--rs:${scale}">
        <div class="badge">${c.code} · Session ${n}${html ? " · " + readMinutes(html) + " min read" : ""}</div>
        <h2>${esc(s.title)}</h2>
        ${quick}
        ${html ? `<details class="session outline"><summary>In this session</summary><div id="outline-body"></div></details>` : ""}
        ${body}
        <label class="row readbtn"><input type="checkbox" id="mark-done" ${isDone(c, n) ? "checked" : ""} /><div class="t">Mark this session as revised</div></label>
        <div class="reader-nav">
          ${prev ? `<button class="btn secondary" data-open="${prev.n}">‹ Session ${prev.n}</button>` : "<span></span>"}
          <button class="btn secondary" id="goto-quiz">Quiz me</button>
          ${next ? `<button class="btn" data-open="${next.n}">Session ${next.n} ›</button>` : "<span></span>"}
        </div>
      </article>`;

    // Build the "In this session" outline from the section headings.
    const heads = [...view.querySelectorAll(".notes h4")].filter((h) => !h.classList.contains("obj-h"));
    heads.forEach((h, i) => { h.id = "rh-" + i; });
    const out = document.getElementById("outline-body");
    if (out) {
      out.innerHTML = heads.map((h) => `<button class="outline-link" data-jump="${h.id}">${esc(h.textContent)}</button>`).join("");
    }

    document.getElementById("back-list").addEventListener("click", () => { learnSession = null; renderLearn(); window.scrollTo({ top: 0 }); });
    const setScale = (delta) => {
      progress.fontScale = Math.min(1.5, Math.max(0.9, Math.round(((progress.fontScale || 1) + delta) * 10) / 10));
      save();
      document.getElementById("reader").style.setProperty("--rs", progress.fontScale);
    };
    document.getElementById("fs-down").addEventListener("click", () => setScale(-0.1));
    document.getElementById("fs-up").addEventListener("click", () => setScale(0.1));
    document.getElementById("mark-done").addEventListener("change", (e) => toggleDone(c, n, e.target.checked));
    document.getElementById("goto-quiz").addEventListener("click", () => { quiz = null; showTab("quiz"); });
    view.querySelectorAll("[data-open]").forEach((el) => {
      el.addEventListener("click", () => openSession(Number(el.dataset.open)));
    });
    view.querySelectorAll("[data-jump]").forEach((el) => {
      el.addEventListener("click", () => {
        const target = document.getElementById(el.dataset.jump);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // ---------- 7. Flashcards ----------
  function renderCards(reshuffle) {
    const c = current();
    if (reshuffle || deck.length === 0 || deck.courseId !== c.id) {
      deck = shuffle(c.flashcards);
      deck.courseId = c.id;
      cardIndex = 0;
      showingBack = false;
    }
    const card = deck[cardIndex];
    view.innerHTML = `
      <div class="card">
        <h2>${c.code} flashcards</h2>
        <p class="hint">Card ${cardIndex + 1} of ${deck.length}. Tap the card to flip it.</p>
        <div class="flash ${showingBack ? "back" : ""}" id="flash">${showingBack ? card.a : card.q}</div>
        <div>
          <button class="btn secondary" id="prev">Previous</button>
          <button class="btn" id="next">Next</button>
          <button class="btn secondary" id="shuffle">Shuffle</button>
        </div>
      </div>`;
    document.getElementById("flash").addEventListener("click", () => { showingBack = !showingBack; renderCards(); });
    document.getElementById("next").addEventListener("click", () => { cardIndex = (cardIndex + 1) % deck.length; showingBack = false; renderCards(); });
    document.getElementById("prev").addEventListener("click", () => { cardIndex = (cardIndex - 1 + deck.length) % deck.length; showingBack = false; renderCards(); });
    document.getElementById("shuffle").addEventListener("click", () => renderCards(true));
  }

  // ---------- 8. Quiz ----------
  function questionPool(c, mode) {
    const limit = scopeOf(c);
    if (mode === "scope") return c.quiz.filter((q) => q.s <= limit);
    if (mode === "weak") {
      const w = progress.wrong[c.id] || {};
      return c.quiz.filter((q) => w[q.s] > 0);
    }
    return c.quiz;
  }

  function renderQuiz() {
    const c = current();

    if (!quiz) {
      const best = progress.best[c.id];
      const counts = {
        all: questionPool(c, "all").length,
        scope: questionPool(c, "scope").length,
        weak: questionPool(c, "weak").length,
      };
      view.innerHTML = `
        <div class="card">
          <h2>${c.code} quiz</h2>
          ${best != null ? `<p>Your best score: <b>${best}</b></p>` : ""}
          <label class="settings"><label>Questions
            <select id="quiz-mode">
              <option value="all" ${quizMode === "all" ? "selected" : ""}>All questions (${counts.all})</option>
              <option value="scope" ${quizMode === "scope" ? "selected" : ""}>Midterm scope only (${counts.scope})</option>
              <option value="weak" ${quizMode === "weak" ? "selected" : ""}>Weak topics only (${counts.weak})</option>
            </select></label></label>
          <p class="hint" id="quiz-note"></p>
          <button class="btn" id="start-quiz">Start quiz</button>
        </div>`;
      const note = document.getElementById("quiz-note");
      const sync = () => {
        quizMode = document.getElementById("quiz-mode").value;
        note.textContent = counts[quizMode] === 0
          ? (quizMode === "weak" ? "No weak topics yet. Take a full quiz first." : "No questions in this selection.")
          : "";
      };
      sync();
      document.getElementById("quiz-mode").addEventListener("change", sync);
      document.getElementById("start-quiz").addEventListener("click", () => {
        const pool = questionPool(c, quizMode);
        if (!pool.length) return;
        quiz = { courseId: c.id, questions: shuffle(pool), index: 0, score: 0, answered: false };
        renderQuiz();
      });
      return;
    }

    if (quiz.index >= quiz.questions.length) {
      const total = quiz.questions.length;
      const pct = Math.round((quiz.score / total) * 100);
      const label = `${quiz.score}/${total}`;
      if (quizMode !== "weak" && total === c.quiz.length) {
        const prev = progress.best[c.id];
        if (prev == null || quiz.score > parseInt(prev, 10)) { progress.best[c.id] = label; save(); }
      }
      view.innerHTML = `
        <div class="card">
          <h2>Quiz complete</h2>
          <div class="score-big">${label}</div>
          <p>${pct}%. ${pct >= 70 ? "Strong work. You are in good shape." : "Good start. Revise the Learn notes and try again."}</p>
          <button class="btn" id="again">Back to quiz menu</button>
        </div>`;
      document.getElementById("again").addEventListener("click", () => { quiz = null; renderQuiz(); });
      return;
    }

    const q = quiz.questions[quiz.index];
    view.innerHTML = `
      <div class="card">
        <p class="hint">Question ${quiz.index + 1} of ${quiz.questions.length} · Score ${quiz.score}</p>
        <h3>${q.q}</h3>
        <div>${q.options.map((o, i) => `<button class="option" data-i="${i}">${o}</button>`).join("")}</div>
        <div class="feedback" id="feedback"></div>
        <button class="btn" id="next-q" style="display:none">Next</button>
      </div>`;
    view.querySelectorAll(".option").forEach((btn) => {
      btn.addEventListener("click", () => answer(Number(btn.dataset.i), q, c));
    });
    document.getElementById("next-q").addEventListener("click", () => { quiz.index++; quiz.answered = false; renderQuiz(); });
  }

  function answer(choice, q, c) {
    if (quiz.answered) return;
    quiz.answered = true;
    const ok = choice === q.answer;
    if (ok) quiz.score++;

    // Track weak topics: a miss adds 1, a correct answer removes 1 (never below 0).
    const w = (progress.wrong[c.id] = progress.wrong[c.id] || {});
    w[q.s] = Math.max(0, (w[q.s] || 0) + (ok ? -1 : 1));
    save();

    view.querySelectorAll(".option").forEach((btn) => {
      const i = Number(btn.dataset.i);
      btn.disabled = true;
      if (i === q.answer) btn.classList.add("correct");
      else if (i === choice) btn.classList.add("wrong");
    });
    document.getElementById("feedback").innerHTML = `<b>${ok ? "Correct!" : "Not quite."}</b> ${q.why}`;
    const next = document.getElementById("next-q");
    next.style.display = "inline-block";
    next.textContent = quiz.index === quiz.questions.length - 1 ? "See results" : "Next";
  }

  // ---------- 9. Tabs and startup ----------
  const renderers = {
    home: renderHome,
    plan: renderPlan,
    learn: renderLearn,
    cards: () => renderCards(),
    quiz: renderQuiz,
  };

  function showTab(name) {
    tab = name;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.getElementById("coursebar").classList.toggle("hidden", name === "home");
    document.getElementById("course-select").value = progress.current;
    renderers[name]();
    window.scrollTo({ top: 0 });
  }

  document.getElementById("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) { if (b.dataset.tab !== "quiz") quiz = null; if (b.dataset.tab === "learn") learnSession = null; showTab(b.dataset.tab); }
  });

  const select = document.getElementById("course-select");
  select.innerHTML = COURSES.map((c) => `<option value="${c.id}">${c.code}: ${c.title}</option>`).join("");
  select.addEventListener("change", () => {
    progress.current = select.value;
    save();
    quiz = null;
    learnSession = null;
    showTab(tab);
  });

  updateChip();
  showTab("home");
})();
