/* PantryPal mockup runtime. Shared by both design directions.
   Data comes from data.js (generated from seed/chef-2026-11.json). */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DESIGN = document.documentElement.dataset.design;
const R = Object.fromEntries(RECIPES.map((r) => [r.key, r]));

/* ---------- emoji for ingredients and meals ---------- */
const EMOJI = [
  [/beef/, "🥩"], [/chicken/, "🍗"], [/salmon|tuna/, "🐟"], [/egg/, "🥚"], [/bacon|pork/, "🥓"],
  [/onion|shallot/, "🧅"], [/garlic/, "🧄"], [/carrot/, "🥕"], [/celery/, "🥬"], [/turnip|parsnip|potato/, "🥔"],
  [/black pepper|peppercorn|pepper flake|red pepper flakes/, "🧂"], [/bell pepper|pepper/, "🫑"], [/broccoli/, "🥦"], [/zucchini|cucumber/, "🥒"], [/lemon/, "🍋"],
  [/basil|dill|rosemary|parsley|cilantro|thyme/, "🌿"], [/cream|milk/, "🥛"], [/butter/, "🧈"],
  [/cheese|parmesan|cheddar/, "🧀"], [/tomato/, "🍅"], [/bean/, "🫘"], [/olive/, "🫒"], [/rice/, "🍚"],
  [/pasta|penne|noodle/, "🍝"], [/flour|cornstarch|oat/, "🌾"], [/honey/, "🍯"], [/sugar|cocoa/, "🍫"],
  [/broth|stock|soup/, "🍲"], [/oil/, "🫒"], [/soy|sesame/, "🥢"], [/salt|pepper|cumin|paprika|chili|oregano|ginger|coriander|flake|spice/, "🧂"],
  [/bread|toast/, "🍞"], [/pancake/, "🥞"], [/banana|berry|apple/, "🍓"], [/yogurt/, "🥣"], [/jar|sun-dried/, "🫙"],
];
const emo = (name) => { const n = name.toLowerCase(); for (const [re, e] of EMOJI) if (re.test(n)) return e; return "🥣"; };
const mealEmoji = { "slow-cooker-chili": "🌶️", "lazy-chicken-soup": "🍲", "marry-me-chicken-pasta": "🍝",
  "mediterranean-salmon-sheet-pan": "🐟", "ground-beef-and-broccoli": "🥦", "overnight-oats": "🥣", "eggs-and-toast": "🍳", "pancakes": "🥞" };

/* ---------- number formatting + scaling ---------- */
function frac(n) {
  if (n == null) return "";
  const whole = Math.floor(n + 1e-6), f = n - whole;
  const map = [[0, ""], [0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, ""]];
  let best = map[0], bd = 9;
  for (const m of map) { const dd = Math.abs(m[0] - f); if (dd < bd) { bd = dd; best = m; } }
  let w = whole + (best[0] === 1 ? 1 : 0);
  const part = best[0] === 1 ? "" : best[1];
  if (!w && !part) return "a pinch";
  return (w ? w : "") + (part ? (w ? " " : "") + part : "");
}
const unitLabel = (u, q) => (!u || u === "count") ? "" : u === "clove" ? (q > 1 ? "cloves" : "clove") : u;
function ingText(i, servings, base) {
  const q = i.q == null ? null : (i.x ? i.q : i.q * servings / base);
  return { q: q == null ? "" : frac(q), u: unitLabel(i.u, q) };
}
const mins = (m) => m >= 120 ? `${Math.floor(m / 60)} hr${m % 60 ? " " + (m % 60) + " min" : ""}` : `${m} min`;

/* ---------- the week (from the seed plan, Mon Nov 2) ---------- */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TODAY = 0;
const W = (b, l, d) => [b, l, d];
const WEEK = [
  [["overnight-oats", "Prepped Sunday night"], ["slow-cooker-chili", "Batch A, cooked Sunday"], ["marry-me-chicken-pasta", "Cook tonight"]],
  [["eggs-and-toast"], ["slow-cooker-chili", "Leftover batch A", 1], ["marry-me-chicken-pasta", "Leftovers from Monday", 1]],
  [["overnight-oats", "Prepped Tuesday night"], ["slow-cooker-chili", "Last of batch A", 1], ["mediterranean-salmon-sheet-pan", "Cook tonight"]],
  [["eggs-and-toast"], ["lazy-chicken-soup", "Batch B, cooked Wednesday"], ["mediterranean-salmon-sheet-pan", "Leftovers from Wednesday", 1]],
  [["overnight-oats", "Prepped Thursday night"], ["lazy-chicken-soup", "Leftover batch B", 1], ["ground-beef-and-broccoli", "Cook tonight"]],
  [["eggs-and-toast", "Pancakes if you feel like it"], ["lazy-chicken-soup", "Last of batch B", 1], ["ground-beef-and-broccoli", "Leftovers from Friday", 1]],
  [["eggs-and-toast"], null, null],
];
const MEALS = ["Breakfast", "Lunch", "Dinner"];

/* ---------- shopping list for next week (mock) ---------- */
const SHOP0 = [
  ["Produce", [["Broccoli florets", "2 heads", "beef & broccoli", 1], ["Red bell pepper", "3", "salmon sheet pan, soup"], ["Lemons", "2", "salmon sheet pan"], ["Fresh basil", "1 bunch", "marry me chicken"], ["Zucchini", "2", "salmon sheet pan"], ["Yellow onion", "2", "chili, beef & broccoli", 1]]],
  ["Meat & fish", [["Ground beef", "2 lb", "chili, beef & broccoli", 1], ["Chicken breast", "2 lb", "marry me chicken, soup"], ["Salmon fillets", "4", "salmon sheet pan"]]],
  ["Dairy", [["Heavy cream", "1 cup", "marry me chicken"], ["Parmesan cheese", "1 small wedge", "marry me chicken"], ["Eggs", "1 dozen", "eggs & toast", 1]]],
  ["Pantry", [["Penne pasta", "1 box", "marry me chicken"], ["Diced tomatoes with green chilies", "2 cans", "chili", 1], ["Kidney beans", "2 cans", "chili"], ["Rolled oats", "1 canister", "overnight oats"]]],
  ["Bakery", [["Sandwich bread", "1 loaf", "eggs & toast"]]],
];

/* ---------- state ---------- */
const S = {
  tab: "week", recipe: null, servings: 0, filter: "all", loc: "all", q: "",
  cook: null, step: 0, ingOpen: false, timer: null, timerLeft: 0,
  shop: SHOP0.map(([a, items]) => [a, items.map(([n, q, why, c]) => ({ n, q, why, c: !!c }))]),
  pantry: PANTRY.map((p) => ({ ...p })),
};
const haveIt = (name) => S.pantry.some((p) => p.n.toLowerCase() === name.toLowerCase() ||
  name.toLowerCase().includes(p.n.toLowerCase()) || p.n.toLowerCase().includes(name.toLowerCase().split(" ").slice(-1)[0]));

/* ---------- icons ---------- */
const ICON = {
  week: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
  shop: '<svg viewBox="0 0 24 24"><path d="M4 9h16l-1.6 9.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8L4 9Z"/><path d="M8.5 9l2.5-4.5M15.5 9 13 4.5"/></svg>',
  pantry: '<svg viewBox="0 0 24 24"><path d="M8 3.5h8v3H8zM6.5 6.5h11v2.2c.9.9 1.5 2 1.5 3.3v6a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18v-6c0-1.3.6-2.4 1.5-3.3V6.5Z"/><path d="M5 13h14"/></svg>',
  recipes: '<svg viewBox="0 0 24 24"><path d="M12 6.5C10.5 5 8 4.5 4.5 4.5v13c3.5 0 6 .5 7.5 2 1.5-1.5 4-2 7.5-2v-13c-3.5 0-6 .5-7.5 2ZM12 6.5v13"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.3 2.9-5 5.5-5s4.9 1.7 5.5 5M16 5.6a3.2 3.2 0 0 1 0 5.8M18.5 14.9c1.4.7 2.5 2.2 3 4.6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
  leftover: '<svg viewBox="0 0 24 24"><path d="M5 11h14l-1.2 7.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 11ZM4 11h16M7 11l1-3h8l1 3"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M12 3c.5 3-3 4.5-3 8a3 3 0 0 0 6 0c0-1-.4-1.8-1-2.5 2.8 1 4.5 3.3 4.5 6.1A6.6 6.6 0 0 1 12 21a6.6 6.6 0 0 1-6.5-6.4C5.5 9 10 7 12 3Z"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/></svg>',
  timer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2 1.5M9.5 3h5"/></svg>',
};
const ic = (n, cls = "") => `<span class="ic ${cls}">${ICON[n]}</span>`;

/* ---------- image / plate ---------- */
function plate(r, cls = "") {
  const e = mealEmoji[r.key] || "🍽️";
  return `<div class="plate ${cls}" style="--h:${hue(r.key)}"><span class="plate-em">${e}</span>${r.image ? `<img src="${r.image}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>`;
}
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

/* ---------- views ---------- */
const TABS = [["week", "Week"], ["shop", "Shop"], ["pantry", "Pantry"], ["recipes", "Recipes"]];

function shell() {
  $("#app").innerHTML = `
  <div class="shell">
    <nav class="nav" aria-label="Main">
      <div class="brand"><span class="brand-mark" aria-hidden="true">${DESIGN === "glaze" ? "🫙" : ""}</span><span class="brand-name">PantryPal</span></div>
      <div class="tabs">${TABS.map(([k, l]) => `<button class="tab" data-tab="${k}" aria-label="${l}"><span class="tab-ico">${ICON[k]}</span><span class="tab-lbl">${l}</span></button>`).join("")}</div>
      <div class="nav-foot"><button class="mode" id="mode" aria-label="Toggle light and dark">${ICON.moon}</button></div>
    </nav>
    <main id="view"></main>
    <div id="overlay"></div>
    <div id="toast" role="status"></div>
  </div>`;
  $$(".tab").forEach((b) => b.onclick = () => { S.tab = b.dataset.tab; render(); $("#view").scrollTo?.(0, 0); window.scrollTo(0, 0); });
  const mode = $("#mode");
  mode.onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = cur === "dark" ? "light" : "dark"; paintMode();
  };
  paintMode();
}
function paintMode() {
  const m = $("#mode"); if (!m) return;
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  m.innerHTML = cur === "dark" ? ICON.sun : ICON.moon;
}

function head(title, sub, extra = "") {
  return `<header class="page-head"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>${extra}</header>`;
}

function viewWeek() {
  const tonight = R[WEEK[TODAY][2][0]];
  const day = (d, i) => {
    const slots = WEEK[i];
    return `<section class="day ${i === TODAY ? "is-today" : ""}" data-day="${i}">
      <h3 class="day-name"><span class="d-short">${DAYS[i]}</span><span class="d-date">Nov ${2 + i}</span>${i === TODAY ? '<span class="today-flag">Today</span>' : ""}</h3>
      <ul class="slots">${slots.map((s, mi) => {
        if (!s) return `<li class="slot empty"><span class="slot-meal">${MEALS[mi]}</span><button class="slot-add" data-toast="Pick a recipe for ${FULL[i]} ${MEALS[mi].toLowerCase()}">${ic("plus")}<span>Plan something</span></button></li>`;
        const r = R[s[0]]; const left = s[2] === 1;
        return `<li class="slot ${left ? "leftover" : ""}"><button class="slot-btn" data-recipe="${r.key}">
          <span class="slot-em">${mealEmoji[r.key]}</span>
          <span class="slot-body"><span class="slot-meal">${MEALS[mi]}</span><span class="slot-title">${r.title}</span>${s[1] ? `<span class="slot-note">${left ? ic("leftover") : ""}${s[1]}</span>` : ""}</span>
        </button></li>`;
      }).join("")}</ul></section>`;
  };
  return `${head("This week", "Mon Nov 2 to Sun Nov 8")}
  <section class="tonight" data-recipe="${tonight.key}">
    ${plate(tonight, "tonight-plate")}
    <div class="tonight-body">
      <p class="tonight-kicker">Dinner tonight</p>
      <h2>${tonight.title}</h2>
      <p class="tonight-meta">${ic("clock")}${mins(tonight.prep + tonight.cook)} ${ic("people")}Cooks 4, leftovers Tuesday</p>
      <div class="tonight-actions"><button class="btn primary" data-cook="${tonight.key}">${ic("flame")}Start cooking</button><button class="btn" data-recipe="${tonight.key}">See recipe</button></div>
    </div>
  </section>
  <aside class="nudge">${ic("timer")}<p><strong>Tomorrow night:</strong> prep Wednesday's overnight oats.</p></aside>
  <div class="days">${DAYS.map(day).join("")}</div>`;
}

function viewShop() {
  const total = S.shop.reduce((a, [, it]) => a + it.length, 0);
  const done = S.shop.reduce((a, [, it]) => a + it.filter((x) => x.c).length, 0);
  const pct = Math.round(done / total * 100);
  return `${head("Shopping", `Week of Nov 9, ${total - done} to go`, `<div class="count"><span class="count-n">${done}</span><span class="count-of">of ${total}</span></div>`)}
  <div class="meter" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
  <div class="aisles">${S.shop.map(([aisle, items], ai) => `
    <section class="aisle" data-aisle="${ai}">
      <h2 class="aisle-name"><span>${aisle}</span><small>${items.filter((x) => !x.c).length ? items.filter((x) => !x.c).length + " left" : "all in the basket"}</small></h2>
      <ul class="items">${items.map((x, ii) => `
        <li class="item ${x.c ? "got" : ""}"><button class="item-btn" data-ai="${ai}" data-ii="${ii}" aria-pressed="${x.c}">
          <span class="box" aria-hidden="true">${ICON.check}</span>
          <span class="item-em" aria-hidden="true">${emo(x.n)}</span>
          <span class="item-body"><span class="item-name">${x.n}<svg class="strike" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><path d="M1 5 C 20 2, 40 7, 60 3.5 S 90 4, 99 3"/></svg></span><span class="item-why">${x.why}</span></span>
          <span class="item-qty">${x.q}</span>
        </button></li>`).join("")}</ul>
    </section>`).join("")}</div>
  <form class="addbar" id="add"><input id="addin" placeholder="Add something we forgot" autocomplete="off" aria-label="Add an item"><button class="btn primary" type="submit">${ic("plus")}Add</button></form>
  <div class="finish"><button class="btn primary big" data-toast="${done} items added to the pantry">${ic("check")}Done shopping</button><p>Checked items go into the pantry.</p></div>`;
}

const LOCS = [["all", "Everything"], ["pantry", "Pantry"], ["fridge", "Fridge"], ["freezer", "Freezer"]];
function viewPantry() {
  const q = S.q.toLowerCase();
  const rows = S.pantry.filter((p) => (S.loc === "all" || p.loc === S.loc) && (!q || p.n.toLowerCase().includes(q)));
  const groups = {}; rows.forEach((p) => (groups[p.loc] ||= []).push(p));
  const order = ["fridge", "pantry", "freezer"].filter((l) => groups[l]);
  const label = { fridge: "Fridge", pantry: "Pantry", freezer: "Freezer" };
  return `${head("Pantry", `${S.pantry.length} things on the shelves`, `<button class="btn primary round-add" data-toast="Add an ingredient" aria-label="Add to pantry">${ic("plus")}<span>Add</span></button>`)}
  <div class="tools">
    <label class="search">${ic("search")}<input id="pq" value="${S.q}" placeholder="Search the pantry" aria-label="Search the pantry"></label>
    <div class="seg" role="tablist">${LOCS.map(([k, l]) => `<button class="seg-b ${S.loc === k ? "on" : ""}" data-loc="${k}">${l}</button>`).join("")}</div>
  </div>
  ${order.length ? order.map((l) => `<section class="shelf" data-loc-group="${l}"><h2 class="shelf-name">${label[l]}<small>${groups[l].length}</small></h2>
    <ul class="stock">${groups[l].map((p) => { const i = S.pantry.indexOf(p); const meas = p.q != null; return `
      <li class="stock-row"><span class="stock-em">${emo(p.n)}</span>
        <span class="stock-body"><span class="stock-name">${p.n}</span>${p.note && !meas ? `<span class="stock-note">${p.note.replace(/;.*/, "")}</span>` : ""}</span>
        ${meas ? `<span class="step"><button data-pi="${i}" data-d="-1" aria-label="Less ${p.n}">${ICON.minus}</button><b>${frac(p.q)} <small>${unitLabel(p.u, p.q)}</small></b><button data-pi="${i}" data-d="1" aria-label="More ${p.n}">${ICON.plus}</button></span>`
          : `<span class="onhand">On hand</span>`}
      </li>`; }).join("")}</ul></section>`).join("") : `<div class="empty"><p class="empty-em">🔎</p><p>Nothing matches "${S.q}". Try another name or add it to the pantry.</p></div>`}`;
}

const FILTERS = [["all", "All"], ["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"]];
function viewRecipes() {
  const list = RECIPES.filter((r) => S.filter === "all" || r.meals.includes(S.filter));
  return `${head("Recipes", `${RECIPES.length} in the box`)}
  <div class="seg wide" role="tablist">${FILTERS.map(([k, l]) => `<button class="seg-b ${S.filter === k ? "on" : ""}" data-filter="${k}">${l}</button>`).join("")}</div>
  <div class="grid">${list.map((r, i) => `
    <article class="rcard" style="--i:${i}"><button data-recipe="${r.key}" aria-label="${r.title}">
      ${plate(r)}
      <div class="rcard-body"><h3>${r.title}</h3>
        <p class="rcard-meta">${ic("clock")}${mins(r.prep + r.cook)}<span class="sep"></span>${ic("people")}${r.servings}</p>
        <p class="rcard-tags">${r.tags.filter((t) => !/^\d|batch|friendly|whole30/.test(t)).slice(0, 3).join(", ")}</p></div>
    </button></article>`).join("")}</div>`;
}

/* ---------- recipe detail ---------- */
function groupBy(arr, key) { const o = []; arr.forEach((x) => { const k = x[key] || ""; let g = o.find((y) => y[0] === k); if (!g) o.push(g = [k, []]); g[1].push(x); }); return o; }
function overlayRecipe() {
  const r = R[S.recipe]; if (!r) return "";
  const ings = groupBy(r.ings, "g");
  const sGroups = groupBy(r.steps, "g");
  let n = 0;
  return `<div class="sheet" role="dialog" aria-label="${r.title}">
    <div class="sheet-scroll">
    <div class="hero">${plate(r, "hero-plate")}<button class="icon-btn back" data-close aria-label="Back">${ICON.back}</button></div>
    <div class="sheet-body">
      <div class="sheet-main">
        <h1 class="r-title">${r.title}</h1>
        <p class="r-meta">${ic("clock")}${mins(r.prep)} prep, ${mins(r.cook)} cooking ${r.cuisine ? `<span class="sep"></span>${r.cuisine}` : ""}</p>
        <p class="r-desc">${r.description}</p>
        <div class="r-badges"><span class="badge ok">${ic("check")}Fits your rules</span>${r.tags.slice(0, 3).map((t) => `<span class="badge">${t.replace(/-/g, " ")}</span>`).join("")}</div>
      </div>
      <section class="ings">
        <div class="ings-head"><h2>Ingredients</h2>
          <div class="step big" aria-label="Servings"><button data-serv="-1" aria-label="Fewer servings">${ICON.minus}</button><b>${S.servings} <small>servings</small></b><button data-serv="1" aria-label="More servings">${ICON.plus}</button></div></div>
        ${ings.map(([g, items]) => `${g ? `<h3 class="grp">${g}</h3>` : ""}<ul class="ing-list">${items.map((i) => {
          const t = ingText(i, S.servings, r.servings); const have = haveIt(i.n);
          return `<li class="ing ${have ? "have" : "need"}"><span class="ing-em">${emo(i.n)}</span><span class="ing-q">${t.q} ${t.u}</span><span class="ing-n">${i.n.toLowerCase()}${i.p ? `<small>, ${i.p}</small>` : ""}${i.o ? "<small> (optional)</small>" : ""}</span><span class="ing-have" title="${have ? "In your pantry" : "Not in your pantry"}">${have ? ICON.check : "•"}</span></li>`; }).join("")}</ul>`).join("")}
        <p class="ing-legend">${ic("check")}in your pantry</p>
      </section>
      <section class="method"><h2>Method</h2>
        ${sGroups.map(([g, steps]) => `${g ? `<h3 class="grp">${g}</h3>` : ""}<ol class="steps">${steps.map((s) => `<li><span class="sn">${++n}</span><p>${s.t}${s.m ? ` <em class="dur">${ic("timer")}${mins(s.m)}</em>` : ""}</p></li>`).join("")}</ol>`).join("")}
      </section>
    </div>
    </div>
    <div class="sheet-bar"><button class="btn primary big" data-cook="${r.key}">${ic("flame")}Cook this</button></div>
  </div>`;
}

/* ---------- cook mode ---------- */
function stepIngs(r, text) {
  const stop = new Set(["ground", "diced", "fresh", "dried", "light", "dark", "red", "yellow", "white", "green", "unsweetened", "granulated", "black", "extra", "virgin", "boneless", "skinless", "sweet", "mixed", "pitted", "in", "oil", "with", "and", "or", "of"]);
  const t = text.toLowerCase();
  return r.ings.filter((i) => i.n.toLowerCase().replace(/[()]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w))
    .some((w) => new RegExp("\\b" + w.replace(/(es|s)$/, "") + "(?!\\s+(broth|sauce|powder|stock|oil))").test(t)));
}
function overlayCook() {
  const r = R[S.cook]; if (!r) return "";
  const st = r.steps[S.step]; const last = S.step === r.steps.length - 1;
  const ings = stepIngs(r, st.t);
  const tm = S.timer != null ? S.timerLeft : null;
  return `<div class="cook" role="dialog" aria-label="Cooking ${r.title}">
    <header class="cook-top"><button class="icon-btn" data-close-cook aria-label="Leave cook mode">${ICON.close}</button>
      <div class="cook-title"><b>${r.title}</b><span>Step ${S.step + 1} of ${r.steps.length}</span></div>
      <button class="icon-btn" data-ings aria-label="All ingredients">${ICON.list}</button></header>
    <div class="cook-prog">${r.steps.map((_, i) => `<i class="${i < S.step ? "done" : i === S.step ? "now" : ""}"></i>`).join("")}</div>
    <div class="cook-main">
      <p class="cook-text">${st.t}</p>
      ${ings.length ? `<div class="cook-ings"><p class="cook-ings-h">You need</p><ul>${ings.map((i) => { const t = ingText(i, S.servings, r.servings); return `<li><span>${emo(i.n)}</span><b>${t.q} ${t.u}</b> ${i.n.toLowerCase()}</li>`; }).join("")}</ul></div>` : ""}
      ${st.m ? `<button class="timer ${tm != null ? "run" : ""}" data-timer="${st.m}">${ic("timer")}<span>${tm != null ? clock(tm) : `Start ${mins(st.m)} timer`}</span></button>` : ""}
    </div>
    <footer class="cook-foot"><button class="btn big" data-prev ${S.step === 0 ? "disabled" : ""}>${ic("back")}Back</button>
      <button class="btn primary big" data-next>${last ? "All done" : "Next step"}${last ? ic("check") : ""}</button></footer>
    ${S.ingOpen ? `<div class="drawer"><div class="drawer-in"><div class="drawer-head"><h2>Ingredients for ${S.servings}</h2><button class="icon-btn" data-ings aria-label="Close">${ICON.close}</button></div>
      <ul class="ing-list">${r.ings.map((i) => { const t = ingText(i, S.servings, r.servings); return `<li class="ing"><span class="ing-em">${emo(i.n)}</span><span class="ing-q">${t.q} ${t.u}</span><span class="ing-n">${i.n.toLowerCase()}</span></li>`; }).join("")}</ul></div></div>` : ""}
  </div>`;
}
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* ---------- render + events ---------- */
function render() {
  $$(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === S.tab));
  $("#view").innerHTML = { week: viewWeek, shop: viewShop, pantry: viewPantry, recipes: viewRecipes }[S.tab]();
  $("#view").dataset.screen = S.tab;
  renderOverlay();
}
function renderOverlay() {
  const o = $("#overlay");
  const html = S.cook ? overlayCook() : S.recipe ? overlayRecipe() : "";
  const keep = $(".sheet-scroll")?.scrollTop;
  o.innerHTML = html;
  o.className = S.cook ? "open cooking" : S.recipe ? "open" : "";
  document.body.classList.toggle("locked", !!html);
  if (keep && S.recipe && !S.cook) $(".sheet-scroll").scrollTop = keep;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2200); }
async function wake() { try { S.wl = await navigator.wakeLock?.request("screen"); } catch {} }
function stopTimer() { clearInterval(S.timerH); S.timer = null; }

document.addEventListener("click", (e) => {
  const t = e.target.closest("button, [data-recipe]"); if (!t) return;
  const d = t.dataset;
  if (d.toast) return toast(d.toast);
  if (d.recipe) { S.recipe = d.recipe; S.servings = R[d.recipe].servings; if (R[d.recipe].servings > 4 && S.tab === "week") S.servings = 2; return renderOverlay(); }
  if (d.cook) { S.recipe = d.cook; S.cook = d.cook; S.step = 0; S.ingOpen = false; stopTimer(); if (!S.servings || R[d.cook].key !== S.recipe) S.servings = R[d.cook].servings; wake(); return renderOverlay(); }
  if ("close" in d) { S.recipe = null; return renderOverlay(); }
  if ("closeCook" in d) { S.cook = null; stopTimer(); S.wl?.release?.(); return renderOverlay(); }
  if (d.serv) { S.servings = Math.max(1, S.servings + +d.serv); return renderOverlay(); }
  if ("ings" in d) { S.ingOpen = !S.ingOpen; return renderOverlay(); }
  if ("prev" in d) { S.step = Math.max(0, S.step - 1); stopTimer(); return renderOverlay(); }
  if ("next" in d) {
    const r = R[S.cook];
    if (S.step === r.steps.length - 1) { S.cook = null; S.recipe = null; stopTimer(); renderOverlay(); return toast("Nice cooking. Pantry updated."); }
    S.step++; stopTimer(); return renderOverlay();
  }
  if (d.timer) {
    if (S.timer != null) { stopTimer(); return renderOverlay(); }
    S.timer = 1; S.timerLeft = Math.min(+d.timer, 99) * 60;
    S.timerH = setInterval(() => { S.timerLeft--; const el = $(".timer span"); if (el) el.textContent = clock(S.timerLeft); if (S.timerLeft <= 0) { stopTimer(); renderOverlay(); toast("Timer done"); } }, 1000);
    return renderOverlay();
  }
  if (d.ai !== undefined) { const it = S.shop[+d.ai][1][+d.ii]; it.c = !it.c; const btn = t; btn.closest(".item").classList.toggle("got", it.c); btn.setAttribute("aria-pressed", it.c); btn.closest(".item").classList.remove("pop"); void btn.offsetWidth; if (it.c) btn.closest(".item").classList.add("pop"); updateShopHead(); return; }
  if (d.loc) { S.loc = d.loc; return render(); }
  if (d.filter) { S.filter = d.filter; return render(); }
  if (d.pi !== undefined) { const p = S.pantry[+d.pi]; const step = ["lb", "cup", "tbsp", "tsp", "oz"].includes(p.u) ? 0.5 : 1; p.q = Math.max(0, +(p.q + +d.d * step).toFixed(2)); return render(); }
});
function updateShopHead() {
  const total = S.shop.reduce((a, [, it]) => a + it.length, 0), done = S.shop.reduce((a, [, it]) => a + it.filter((x) => x.c).length, 0);
  $(".count-n").textContent = done; $(".meter i").style.width = Math.round(done / total * 100) + "%";
  $(".page-head .sub").textContent = `Week of Nov 9, ${total - done} to go`;
  $$(".aisle").forEach((a, ai) => { const left = S.shop[ai][1].filter((x) => !x.c).length; $("small", a).textContent = left ? left + " left" : "all in the basket"; });
  $(".finish .btn").dataset.toast = `${done} items added to the pantry`;
}
document.addEventListener("input", (e) => { if (e.target.id === "pq") { S.q = e.target.value; const pos = e.target.selectionStart; render(); const el = $("#pq"); el.focus(); el.setSelectionRange(pos, pos); } });
document.addEventListener("submit", (e) => {
  if (e.target.id === "add") { e.preventDefault(); const v = $("#addin").value.trim(); if (!v) return; S.shop[S.shop.length - 1][1].push({ n: v[0].toUpperCase() + v.slice(1), q: "1", why: "added by hand", c: false }); render(); toast(`Added ${v}`); }
});
document.addEventListener("keydown", (e) => {
  if (S.cook) { if (e.key === "ArrowRight") $("[data-next]")?.click(); if (e.key === "ArrowLeft") $("[data-prev]")?.click(); if (e.key === "Escape") $("[data-close-cook]")?.click(); }
  else if (S.recipe && e.key === "Escape") $("[data-close]")?.click();
});

shell();
const params = new URLSearchParams(location.search);
if (params.get("tab")) S.tab = params.get("tab");
render();
if (params.get("recipe")) { S.recipe = params.get("recipe"); S.servings = R[S.recipe].servings; renderOverlay(); }
if (params.get("cook")) { S.recipe = S.cook = params.get("cook"); S.servings = R[S.cook].servings; S.step = +(params.get("step") || 0); renderOverlay(); }
if (params.get("theme")) document.documentElement.dataset.theme = params.get("theme");
paintMode();
