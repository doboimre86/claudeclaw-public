// === Dashboard auth bootstrap (HttpOnly cookie) ===
// On first visit, the server prints an URL like /?token=XXX. We POST that token
// to /api/auth/login which sets an HttpOnly cookie (cc_session). Subsequent
// fetches simply rely on the cookie — no token in JS-readable storage.
//
// Backwards compat: if a legacy token is still in localStorage, exchange it
// for a cookie once and then wipe it.
;(() => {
  const LEGACY_KEY = "nova-dashboard-token"

  async function exchangeForCookie(token) {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      return res.ok
    } catch { return false }
  }

  // Bootstrap promise — gates all early fetches until login completes.
  // Security #4: a token mostantól URL fragment-ben is érkezhet (#token=...).
  // Fragment a szerverhez NEM megy (Traefik/proxy access-log sose látja),
  // bookmark-ra se kerül a Referer header-be. Query-string (?token=...)
  // backward-compat módban még elfogadjuk, de új URL-t fragmentben ajánljuk.
  window.__authReady = (async () => {
    const urlParams = new URLSearchParams(window.location.search)
    const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''))
    const fragmentToken = hashParams.get("token")
    const queryToken = urlParams.get("token")
    const urlToken = fragmentToken || queryToken

    if (urlToken) {
      await exchangeForCookie(urlToken)
      // Töröljük mindkét helyről a tokent — fragment + query —, hogy ne
      // maradjon a böngésző history-ben / bookmark-ban sehol.
      if (queryToken) urlParams.delete("token")
      if (fragmentToken) hashParams.delete("token")
      const newHash = hashParams.toString()
      const clean = window.location.pathname
        + (urlParams.toString() ? "?" + urlParams : "")
        + (newHash ? "#" + newHash : "")
      window.history.replaceState({}, "", clean)
    } else {
      // Legacy migration: exchange any leftover localStorage token for a cookie
      try {
        const legacy = localStorage.getItem(LEGACY_KEY)
        if (legacy) {
          await exchangeForCookie(legacy)
        }
      } catch {}
    }
    // Wipe legacy storage regardless (no token left in JS-accessible storage)
    try { localStorage.removeItem(LEGACY_KEY) } catch {}
  })()

  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    // Wait for the cookie exchange to finish before the very first API call
    if (window.__authReady) { try { await window.__authReady } catch {} }
    const url = typeof input === "string" ? input : (input instanceof Request ? input.url : String(input))
    const isSameOriginApi =
      url.startsWith("/api/") ||
      (url.startsWith(window.location.origin + "/api/"))
    // Always include credentials (cookie) on same-origin API calls
    if (isSameOriginApi) {
      init = init || {}
      if (!init.credentials) init.credentials = "same-origin"
    }
    const res = await originalFetch(input, init)
    if (res.status === 401 && isSameOriginApi) {
      if (!window.__novaAuthPrompted) {
        window.__novaAuthPrompted = true
        const banner = document.createElement("div")
        banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;padding:16px 20px;background:#bf4d43;color:#fff;font-family:system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2)"
        banner.setAttribute("role", "alert")
        banner.innerHTML = "<strong>Bejelentkezés szükséges.</strong> A dashboard eléréséhez keresd meg a szerver logban a hozzáférési URL-t (<code>?token=...</code>), és nyisd meg újra a böngésződben."
        if (document.body) document.body.appendChild(banner)
        console.error("Dashboard authentication failed (401). Check server log for access URL.")
      }
    }
    return res
  }
})()

// === Theme ===
const html = document.documentElement
const themeToggle = document.getElementById('themeToggle')
const savedTheme = localStorage.getItem('cc-theme')

function updateThemeAriaLabel(theme) {
  themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Váltás világos módra' : 'Váltás sötét módra')
}

if (savedTheme) {
  html.setAttribute('data-theme', savedTheme)
  updateThemeAriaLabel(savedTheme)
} else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  html.setAttribute('data-theme', 'dark')
  updateThemeAriaLabel('dark')
} else {
  updateThemeAriaLabel('light')
}
themeToggle.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
  html.setAttribute('data-theme', next)
  localStorage.setItem('cc-theme', next)
  updateThemeAriaLabel(next)
})

// === Language ===
const translations = {
  hu: {}, // magyar az alap — a HTML-ben van
  en: {
    // Nav
    'Kanban': 'Kanban', 'Csapat': 'Team', 'Ütemezések': 'Schedules',
    'Memória': 'Memory', 'Skillek': 'Skills', 'Connectorok': 'Connectors',
    'Státusz': 'Status', 'Napló': 'Daily Log', 'Költöztetés': 'Migration',
    // Kanban
    'Tervezett': 'Planned', 'Folyamatban': 'In Progress', 'Várakozik': 'Waiting', 'Kész': 'Done',
    // Page titles & subtitles
    'AI csapattagok kezelése': 'AI team member management',
    'Időzített feladatok kezelése': 'Scheduled task management',
    'AI csapat tudásbázisa': 'AI team knowledge base',
    'MCP szerverek kezelése': 'MCP server management',
    'Claude szolgáltatások állapota': 'Claude service status',
    'Napi tevékenységek és események': 'Daily activities and events',
    'Korábbi AI asszisztens rendszer átmigrálása': 'Migrate from a previous AI assistant system',
    // Buttons
    'Új kártya': 'New Card', 'Mentés': 'Save', 'Mégse': 'Cancel', 'Törlés': 'Delete',
    'Szerkesztés': 'Edit', 'Archiválás': 'Archive', 'Indítás': 'Start', 'Leállítás': 'Stop',
    'Új ágens': 'New Agent', 'Új feladat': 'New Task', 'Új emlék': 'New Memory',
    'Új connector': 'New Connector', 'Frissítés': 'Refresh', 'Küldés': 'Send',
    'Telepítés': 'Install', 'Telepítve': 'Installed',
    'Hozzáadás': 'Add', 'Összekapcsolás': 'Connect',
    'Leválasztás': 'Disconnect', 'Kapcsolat tesztelése': 'Test Connection',
    'Létrehozás': 'Create', 'Generálás': 'Generate',
    'Tovább': 'Next', 'Vissza': 'Back',
    'Importálás': 'Import', 'Jóváhagyás': 'Approve',
    'Várakozók frissítése': 'Refresh Pending',
    'Feltérképezés': 'Scan',
    'Skill generálás': 'Skill Generation',
    // Agent detail tabs
    'Áttekintés': 'Overview', 'Beállítások': 'Settings', 'Telegram': 'Telegram',
    // Memory tabs
    'Megosztott': 'Shared', 'Gráf': 'Graph',
    // Status
    'Fut': 'Running', 'Leállva': 'Stopped', 'Csatlakozva': 'Connected',
    'Minden szolgáltatás működik': 'All services operational',
    'Aktiv incidens': 'Active incident',
    'Státusz nem elérhető': 'Status unavailable',
    'Nincs aktív incidens': 'No active incidents',
    // Priorities
    'Alacsony': 'Low', 'Normál': 'Normal', 'Magas': 'High', 'Sürgős': 'Urgent',
    // Form labels
    'Cím': 'Title', 'Leírás': 'Description', 'Felelős': 'Assignee',
    'Prioritás': 'Priority', 'Határidő': 'Due Date', 'Megjegyzések': 'Comments',
    'Modell': 'Model', 'Tartalom': 'Content', 'Kulcsszavak': 'Keywords',
    'Ágens': 'Agent', 'Név': 'Name', 'Prompt': 'Prompt', 'Gyakoriság': 'Frequency',
    'Időpont': 'Time', 'Típus': 'Type', 'Hatókör': 'Scope',
    'Címkék': 'Labels', 'Blokkolja': 'Blocked by',
    'Parancs': 'Command', 'Argumentumok': 'Arguments',
    'Sablon': 'Template', 'Cron kifejezés': 'Cron expression',
    'Cél ágens': 'Target Agent',
    'Workspace / mappa útvonala': 'Workspace / folder path',
    '1. Forrás megadása': '1. Source',
    'Hozzárendelés ágensekhez': 'Assign to agents',
    'Fájl (.md, .txt, .json)': 'File (.md, .txt, .json)',
    'Skill neve': 'Skill Name',
    'Skill fájl (.skill)': 'Skill file (.skill)',
    'Válassz avatart': 'Choose avatar', 'Válassz új avatart': 'Choose new avatar',
    // Hints
    'opcionális': 'optional', 'rövid': 'short',
    'vesszővel elválasztva, keresést segíti': 'comma separated, helps search',
    'vesszővel elválasztva': 'comma separated',
    'kártya ID-k': 'card IDs',
    'perc óra nap hónap hétnap': 'minute hour day month weekday',
    // Catalog
    'Telepített': 'Installed', 'MCP Katalógus': 'MCP Catalog',
    'Összes': 'All', 'Produktivitás': 'Productivity', 'Kommunikáció': 'Communication',
    'Keresés': 'Search', 'Fejlesztés': 'Development', 'AI': 'AI', 'Pénzügy': 'Finance',
    // Connector
    'Beépített': 'Built-in',
    'Aktív': 'Active', 'Kikapcsolva': 'Disabled',
    'Auth szükséges': 'Auth required', 'Hibás': 'Failed', 'Ismeretlen': 'Unknown',
    // Schedule types & frequencies
    'Feladat (mindig szól)': 'Task (always notify)',
    'Heartbeat (csak ha fontos)': 'Heartbeat (only if important)',
    'Naponta': 'Daily', 'Hétköznap': 'Weekdays',
    'Hetente (hétfő)': 'Weekly (Monday)', 'Hetente (péntek)': 'Weekly (Friday)',
    'Óránként': 'Hourly', '2 óránként': 'Every 2 hours',
    '4 óránként': 'Every 4 hours', '30 percenként': 'Every 30 minutes',
    'Egyéni cron...': 'Custom cron...',
    'Intelligens kibővítés': 'Smart Expansion',
    // Schedule template options
    'Egyéni...': 'Custom...',
    'Naptár figyelő': 'Calendar monitor',
    'Email figyelő': 'Email monitor',
    'Kanban határidő figyelő': 'Kanban deadline monitor',
    'Teljes ellenőrzés': 'Full check',
    // Schedule badges
    'aktív': 'active', 'szünet': 'paused',
    'Szüneteltetés': 'Pause', 'Folytatás': 'Resume',
    // Chat
    'Chat Nova-val': 'Chat with Agent',
    // Modal titles
    'Új ütemezett feladat': 'New Scheduled Task', 
    'Kártya': 'Card', 'Új ágens létrehozása': 'Create New Agent',
    'Ágens részletek': 'Agent Details', 'Új skill': 'New Skill',
    'Skill részletek': 'Skill Details', 
    'Connector részletek': 'Connector Details', 'Rendszer költöztetés': 'System Migration',
    'MCP telepítés': 'MCP Install', 
    'Új skill generálása': 'Generate New Skill',
    // Agent wizard labels
    'Írd le szabadon, mit szeretnél hogy csináljon ez az ágens': 'Describe freely what you want this agent to do',
    'Írd le szabadon, mit csináljon ez a skill': 'Describe freely what this skill should do',
    'Leírás (prompt a generáláshoz)': 'Description (prompt for generation)',
    // Agent model options
    'Öröklött (alapértelmezett)': 'Inherited (default)',
    'Opus (legjobb minőség)': 'Opus (best quality)',
    'Sonnet (gyors és okos)': 'Sonnet (fast and smart)',
    'Haiku (leggyorsabb)': 'Haiku (fastest)',
    'Sonnet 4.6 (alapértelmezett)': 'Sonnet 4.6 (default)',
    'Opus 4.6 (legjobb minőség)': 'Opus 4.6 (best quality)',
    'Haiku 4.5 (leggyorsabb)': 'Haiku 4.5 (fastest)',
    '☁️ Claude (felhő)': '☁️ Claude (cloud)',
    '🏠 Ollama (lokális)': '🏠 Ollama (local)',
    // Agent detail sections
    'Telegram bot bekötése': 'Telegram Bot Setup',
    'Párosítás': 'Pairing', 'Párosítási kód': 'Pairing Code',
    'Bot API Token': 'Bot API Token',
    'Ágens skilljei': 'Agent Skills',
    // Memory tier options
    'Hot (aktív)': 'Hot (active)',
    'Warm (stabil)': 'Warm (stable)',
    'Cold (archív)': 'Cold (archive)',
    'Shared (megosztott)': 'Shared',
    // Memory search
    'Hibrid keresés': 'Hybrid search',
    'Kulcsszavas': 'Keyword',
    'Minden ágens': 'All agents',
    // Migration options
    'Egyéni Claude bot': 'Custom Claude bot',
    'Általános mappa': 'General folder',
    // Migration steps
    '2. Találatok': '2. Results', '3. Eredmény': '3. Result',
    'Találatok': 'Results', 'Eredmény': 'Result',
    // Connector scope options
    'Globális (minden projekt)': 'Global (all projects)',
    'Projekt szintű': 'Project level',
    'Távoli (HTTP URL)': 'Remote (HTTP URL)',
    'Lokális (parancs)': 'Local (command)',
    // Status page sections
    'Szolgáltatások': 'Services', 'Incidensek': 'Incidents',
    // Incident statuses
    'Figyelés': 'Monitoring', 'Azonosítva': 'Identified', 'Vizsgálat': 'Investigating',
    // Home page cards
    'Rendszer': 'System', 'Mai költség': 'Today\'s Cost',
    'Kanban összesítő': 'Kanban Summary', 'Mai napló': 'Today\'s Log',
    // Home dynamic
    'Rendben': 'OK', 'Hiba': 'Error', 'Nem elérhető': 'Unavailable',
    'Nincs kártya': 'No cards',
    'Ma még nincs bejegyzés': 'No entries today',
    'Nem sikerült betölteni': 'Failed to load',
    // Dynamic labels
    'Nincs bekötve': 'Not connected',
    'Nincsenek ütemezett feladatok': 'No scheduled tasks',
    'Nincs feladat': 'No tasks',
    'Nincsenek MCP connectorok': 'No MCP connectors',
    'Nincsenek hozzárendelhető ágensek': 'No assignable agents',
    'Nincs várakozó párosítás': 'No pending pairings',
    'Nincs adat': 'No data',
    '-- Nincs --': '-- None --',
    // Usage stats
    'Összköltség': 'Total Cost', 'Input tokenek': 'Input Tokens',
    'Output tokenek': 'Output Tokens', 'Kérések': 'Requests',
    // Confirm dialogs
    'Biztosan leállítod az ágenst?': 'Are you sure you want to stop the agent?',
    'Biztosan törlöd ezt a feladatot?': 'Are you sure you want to delete this task?',
    'Biztosan törlöd a chat előzményeket?': 'Are you sure you want to delete chat history?',
    // Toast messages
    'Feladat szüneteltetve': 'Task paused', 'Feladat újraindult': 'Task resumed',
    'Feladat törölve': 'Task deleted', 'Hiba történt': 'An error occurred',
    // Placeholders
    'Keresés az emlékekben...': 'Search memories...',
    'Keresés név vagy leírás alapján...': 'Search by name or description...',
    'Feladat megnevezése': 'Task name',
    'Részletek, kontextus...': 'Details, context...',
    'Megjegyzés írása...': 'Write a comment...',
    'Mit kell megjegyezni...': 'What to remember...',
    'Röviden írd le mit csináljon': 'Briefly describe what it should do',
    'Mit csinál ez a feladat': 'What this task does',
    'Röviden írd le mit csináljon (pl. \'nézd meg az emailjeimet és foglald össze\')': 'Briefly describe what it should do (e.g. \'check my emails and summarize\')',
    'Írd le mit csináljon a skill, mire használod, milyen eszközöket használjon...': 'Describe what the skill should do, what you use it for, what tools it should use...',
    // Skill categories
    'Fotó': 'Photo', 'Marketing': 'Marketing', 'Blog': 'Blog',
    'Dokumentum': 'Document', 'Automatizáció': 'Automation',
    'CRM': 'CRM', 'Design': 'Design', 'Dev': 'Dev', 'Egyéb': 'Other',
    // Daily log
    'Napi napló': 'Daily Log', 'Ma': 'Today',
    // Misc
    'Betöltés...': 'Loading...',
    'Részletek betöltése sikertelen': 'Failed to load details',
    'Nem sikerült betölteni a státuszt': 'Failed to load status',
    'Nincs aktív incidens — minden rendben működik.': 'No active incidents — all systems operational.',
    // Migration types
    'Személyiség': 'Personality', 'Felhasználói profil': 'User profile',
    'Hot memória': 'Hot memory',
    'Warm memória': 'Warm memory', 'Cold memória': 'Cold memory',
    'Heartbeat konfig': 'Heartbeat config', 'Konfiguráció': 'Configuration',
    'Ütemezés': 'Schedule',
    // Cron descriptions
    'Minden órában': 'Every hour',
    'percenként': 'every minute(s)', 'óránként': 'every hour(s)',
    'Hétvégén': 'Weekends',
    'Hétfőn': 'Monday', 'Kedden': 'Tuesday', 'Szerdán': 'Wednesday',
    'Csütörtökön': 'Thursday', 'Pénteken': 'Friday', 'Szombaton': 'Saturday', 'Vasárnap': 'Sunday',
    // textContent assignments
    'Kártya szerkesztése': 'Edit Card',
    'CLAUDE.md generálás...': 'Generating CLAUDE.md...',
    'SOUL.md generálás...': 'Generating SOUL.md...',
    'Kész!': 'Done!',
    'Kérdések generálása...': 'Generating questions...',
    'Hiba a kérdések generálásakor': 'Error generating questions',
    'Emlék szerkesztése': 'Edit Memory',
    'Fájlok feldolgozása...': 'Processing files...',
    'Kapcsolódási hiba': 'Connection error',
    'Hiba a betöltés során': 'Error during loading',
    'Generálás...': 'Generating...',
    // showToast messages
    'Hiba az áthelyezés során': 'Error during move',
    'Kártya frissítve': 'Card updated',
    'Kártya létrehozva': 'Card created',
    'Hiba a mentés során': 'Error during save',
    'Hiba a megjegyzés mentése során': 'Error saving comment',
    'Kártya archiválva': 'Card archived',
    'Hiba az archiválás során': 'Error during archiving',
    'Kártya törölve': 'Card deleted',
    'Hiba a törlés során': 'Error during deletion',
    'Ágens sikeresen létrehozva!': 'Agent created successfully!',
    'Skill nem található': 'Skill not found',
    'Skill mentve': 'Skill saved',
    'Mentés sikertelen': 'Save failed',
    'Ágens betöltése sikertelen': 'Failed to load agent',
    'Ágens törölve': 'Agent deleted',
    'Avatar frissítve': 'Avatar updated',
    'Hiba az avatar mentése során': 'Error saving avatar',
    'Ágens elindítva!': 'Agent started!',
    'Ágens leállítva': 'Agent stopped',
    'Modell mentve (újraindítás szükséges)': 'Model saved (restart required)',
    'Kapcsolat tesztelése sikertelen': 'Connection test failed',
    'Párosítás jóváhagyva!': 'Pairing approved!',
    'Telegram bot leválasztva': 'Telegram bot disconnected',
    'Hiba a leválasztás során': 'Error during disconnection',
    'Skill törölve': 'Skill deleted',
    'Hiba a Nova skillek lekérése során': 'Error fetching Nova skills',
    'Minden Nova skill már hozzá van adva': 'All Nova skills already added',
    'Jelölj ki legalább egy skillt': 'Select at least one skill',
    'Hiba a skillek másolása során': 'Error copying skills',
    'Skill hozzáadva': 'Skill added',
    'Válaszolj legalább egy kérdésre': 'Answer at least one question',
    'Prompt kibővítve!': 'Prompt expanded!',
    'Hiba a kibővítés során': 'Error during expansion',
    'Válassz ütemezést': 'Select a schedule',
    'Feladat frissítve': 'Task updated',
    'Feladat létrehozva!': 'Task created!',
    'Emlék frissítve': 'Memory updated',
    'Emlék létrehozva': 'Memory created',
    'Hiba a vektor generálás során': 'Error during vector generation',
    'Emlék törölve': 'Memory deleted',
    'Connector törölve': 'Connector deleted',
    'Válassz legalább egy ágenst': 'Select at least one agent',
    'Hiba a hozzárendelés során': 'Error during assignment',
    'Connector hozzáadva!': 'Connector added!',
    'Válassz legalább egy fájlt': 'Select at least one file',
    'Nincs importálható tartalom a fájlokban': 'No importable content in files',
    'Hiba a költöztetés során': 'Error during migration',
    'Név és leírás kötelező': 'Name and description required',
    'Hiba a skill generálása során': 'Error generating skill',
    'Hiba a telepítés során': 'Error during installation',
    'Telegram bot sikeresen csatlakoztatva!': 'Telegram bot connected successfully!',
    'Válassz egy .skill fájlt': 'Select a .skill file',
    // confirm dialogs
    'Biztosan törlöd ezt a kártyát?': 'Are you sure you want to delete this card?',
    'Biztosan leválasztod a Telegram botot?': 'Are you sure you want to disconnect the Telegram bot?',
    // innerHTML
    'Hibás API válasz': 'Invalid API response',
    'Nincs skill adat': 'No skill data',
  }
}

let currentLang = localStorage.getItem('claudeclaw-lang') || 'hu'

function t(text) {
  if (currentLang === 'hu') return text
  return translations.en[text] || text
}

function switchLanguage() {
  currentLang = currentLang === 'hu' ? 'en' : 'hu'
  localStorage.setItem('claudeclaw-lang', currentLang)
  const btn = document.getElementById('langToggle')
  if (btn) btn.textContent = currentLang === 'hu' ? 'EN' : 'HU'
  applyTranslations()
}

function applyTranslations() {
  // Nav links
  document.querySelectorAll('.nav-link').forEach(el => {
    const text = el.textContent.trim()
    if (currentLang === 'en') {
      const en = translations.en[text]
      if (en) el.textContent = en
    } else {
      const huKey = Object.keys(translations.en).find(k => translations.en[k] === text)
      if (huKey) el.textContent = huKey
    }
  })

  // Kanban column titles
  document.querySelectorAll('.kanban-col-title').forEach(el => {
    const status = el.closest('.kanban-col')?.dataset.status
    const labels = currentLang === 'en'
      ? { planned: 'Planned', in_progress: 'In Progress', waiting: 'Waiting', done: 'Done' }
      : { planned: 'Tervezett', in_progress: 'Folyamatban', waiting: 'Várakozik', done: 'Kész' }
    if (status && labels[status]) el.textContent = labels[status]
  })

  // Page titles (h1) and subtitles
  document.querySelectorAll('.page-header h1, .page-header .subtitle').forEach(el => {
    const text = el.textContent.trim()
    if (currentLang === 'en') {
      const en = translations.en[text]
      if (en) el.textContent = en
    } else {
      const huKey = Object.keys(translations.en).find(k => translations.en[k] === text)
      if (huKey) el.textContent = huKey
    }
  })

  // Buttons with specific text
  document.querySelectorAll('.btn-primary .btn-text, .btn-secondary .btn-text, .btn-primary, .btn-secondary, .btn-danger').forEach(el => {
    const text = el.textContent.trim()
    if (currentLang === 'en') {
      const en = translations.en[text]
      if (en) el.textContent = en
    } else {
      const huKey = Object.keys(translations.en).find(k => translations.en[k] === text)
      if (huKey) el.textContent = huKey
    }
  })

  // Catalog filter buttons
  document.querySelectorAll('.catalog-filter-btn').forEach(el => {
    const text = el.textContent.trim()
    if (currentLang === 'en') {
      const en = translations.en[text]
      if (en) el.textContent = en
    } else {
      const huKey = Object.keys(translations.en).find(k => translations.en[k] === text)
      if (huKey) el.textContent = huKey
    }
  })

  // Connector tabs
  document.querySelectorAll('.connector-tab').forEach(el => {
    const text = el.textContent.trim()
    if (currentLang === 'en') {
      const en = translations.en[text]
      if (en) el.textContent = en
    } else {
      const huKey = Object.keys(translations.en).find(k => translations.en[k] === text)
      if (huKey) el.textContent = huKey
    }
  })

  // Agent detail tabs
  document.querySelectorAll('.tab-btn').forEach(el => {
    const text = el.textContent.trim()
    if (currentLang === 'en') {
      const en = translations.en[text]
      if (en) el.textContent = en
    } else {
      const huKey = Object.keys(translations.en).find(k => translations.en[k] === text)
      if (huKey) el.textContent = huKey
    }
  })

  // Memory tabs - handle emoji prefixes
  document.querySelectorAll('.mem-tab').forEach(el => {
    const text = el.textContent.trim()
    if (text.includes('Megosztott') && currentLang === 'en') el.textContent = el.textContent.replace('Megosztott', 'Shared')
    if (text.includes('Shared') && currentLang === 'hu') el.textContent = el.textContent.replace('Shared', 'Megosztott')
    if (text.includes('Gráf') && currentLang === 'en') el.textContent = el.textContent.replace('Gráf', 'Graph')
    if (text.includes('Graph') && currentLang === 'hu') el.textContent = el.textContent.replace('Graph', 'Gráf')
    if (text.includes('Napló') && currentLang === 'en') el.textContent = el.textContent.replace('Napló', 'Log')
    if (text.includes('Log') && currentLang === 'hu' && !text.includes('Napló')) el.textContent = el.textContent.replace('Log', 'Napló')
  })

  
  // Deep translate: labels, headings, options, placeholders, btn-text, optgroups, home cards
  if (currentLang !== 'hu') {
    document.querySelectorAll('label, h2, h3, h4, .btn-text, .hint, .migrate-step h3, .home-card-title, .usage-stat-label, .stat-label').forEach(el => {
      if (el.children.length > 1) return // skip complex elements
      const text = el.textContent.trim()
      const en = translations.en[text]
      if (en) el.textContent = en
    })
    document.querySelectorAll('select option').forEach(el => {
      const text = el.textContent.trim()
      const en = translations.en[text]
      if (en) el.textContent = en
    })
    document.querySelectorAll('select optgroup').forEach(el => {
      const lbl = el.label
      const en = translations.en[lbl]
      if (en) el.label = en
    })
    document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
      const ph = el.placeholder
      const en = translations.en[ph]
      if (en) el.placeholder = en
    })
  } else {
    // Restore Hungarian from translations (reverse lookup)
    document.querySelectorAll('label, h2, h3, h4, .btn-text, .hint, .migrate-step h3, .home-card-title, .usage-stat-label, .stat-label').forEach(el => {
      if (el.children.length > 1) return
      const text = el.textContent.trim()
      const huKey = Object.keys(translations.en).find(k => translations.en[k] === text)
      if (huKey) el.textContent = huKey
    })
    document.querySelectorAll('select option').forEach(el => {
      const text = el.textContent.trim()
      const huKey = Object.keys(translations.en).find(k => translations.en[k] === text)
      if (huKey) el.textContent = huKey
    })
    document.querySelectorAll('select optgroup').forEach(el => {
      const lbl = el.label
      const huKey = Object.keys(translations.en).find(k => translations.en[k] === lbl)
      if (huKey) el.label = huKey
    })
    document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach(el => {
      const ph = el.placeholder
      const huKey = Object.keys(translations.en).find(k => translations.en[k] === ph)
      if (huKey) el.placeholder = huKey
    })
  }

  // Section headers
  document.querySelectorAll('.connector-section-header').forEach(el => {
    const text = el.textContent.trim()
    if (currentLang === 'en') {
      const en = translations.en[text]
      if (en) el.textContent = en
    } else {
      const huKey = Object.keys(translations.en).find(k => translations.en[k] === text)
      if (huKey) el.textContent = huKey
    }
  })
}

// === Page switching ===
const navLinks = document.querySelectorAll('.nav-link[data-page]')
const pages = document.querySelectorAll('.page')

function switchPage(pageId, updateHash = true) {
  pages.forEach((p) => (p.hidden = p.id !== pageId + 'Page'))
  navLinks.forEach((l) => {
    const isActive = l.dataset.page === pageId
    l.classList.toggle('active', isActive)
    if (isActive) {
      l.setAttribute('aria-current', 'page')
    } else {
      l.removeAttribute('aria-current')
    }
  })
  if (updateHash) window.location.hash = pageId
  if (pageId === 'home') loadHome()
  if (pageId === 'kanban') loadKanban()
  if (pageId === 'tasks') loadSchedules()
  if (pageId === 'agents') loadAgents()
  if (pageId === 'memories') { loadMemAgents(); loadMemStats(); loadMemories() }
  if (pageId === 'skills') loadSkillsPage()
  if (pageId === 'connectors') loadConnectors()
  if (pageId === 'migrate') loadMigrateAgents()
  if (pageId === 'status') loadStatus()
  if (pageId === 'daily') loadDailyLog()
  if (pageId === 'updates') loadUpdates()
}

navLinks.forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault()
    switchPage(link.dataset.page)
    // Mobilon menü bezárása kattintás után
    const nav = document.querySelector('nav[role="navigation"]')
    if (nav) nav.classList.remove('open')
  })
})

// === Home Page ===
async function loadHome() {
  // Health
  try {
    const res = await fetch('/api/health')
    const h = await res.json()
    document.getElementById('homeHealthStatus').textContent = h.status === 'ok' ? t('Rendben') : t('Hiba')
    const memVal = typeof h.memoryMB === 'object' && h.memoryMB !== null ? (h.memoryMB.rss ?? h.memoryMB.heap ?? 0) : h.memoryMB
    document.getElementById('homeHealthSub').textContent = `Uptime: ${Math.floor(h.uptime / 3600)}h ${Math.floor((h.uptime % 3600) / 60)}m | ${memVal} MB RAM`
    document.getElementById('homeHealth').querySelector('.home-card-icon').style.color = h.status === 'ok' ? 'var(--success)' : 'var(--danger)'
  } catch {
    document.getElementById('homeHealthStatus').textContent = t('Nem elérhető')
  }

  // Agents
  try {
    const res = await fetch('/api/agents')
    const agents = await res.json()
    const running = agents.filter(a => a.running).length
    document.getElementById('homeAgentCount').textContent = currentLang === 'en' ? `${agents.length + 1} agents` : `${agents.length + 1} ágens`
    document.getElementById('homeAgentSub').textContent = currentLang === 'en' ? `${running + 1} running (Nova + ${running} sub-agent)` : `${running + 1} fut (Nova + ${running} sub-agent)`
  } catch {
    document.getElementById('homeAgentCount').textContent = '?'
  }

  // Memory
  try {
    const res = await fetch('/api/memories/stats')
    const stats = await res.json()
    document.getElementById('homeMemCount').textContent = currentLang === 'en' ? `${stats.total} memories` : `${stats.total} emlék`
    const hot = stats.byCategory?.hot || 0
    const warm = stats.byCategory?.warm || 0
    document.getElementById('homeMemSub').textContent = `${hot} hot | ${warm} warm`
  } catch {
    document.getElementById('homeMemCount').textContent = '?'
  }

  // Usage (today)
  try {
    const res = await fetch('/api/usage?days=1')
    const u = await res.json()
    document.getElementById('homeUsageCost').textContent = `$${u.totalCost.toFixed(2)}`
    const formatNum = (n) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
    document.getElementById('homeUsageSub').textContent = currentLang === 'en' ? `${formatNum(u.totalInput + u.totalOutput)} tokens | ${u.entries} requests` : `${formatNum(u.totalInput + u.totalOutput)} token | ${u.entries} kérés`
  } catch {
    document.getElementById('homeUsageCost').textContent = '$0'
  }

  // Kanban summary
  try {
    const res = await fetch('/api/kanban')
    const cards = await res.json()
    const active = cards.filter(c => !c.archived)
    const counts = { planned: 0, in_progress: 0, waiting: 0, done: 0 }
    for (const c of active) counts[c.status] = (counts[c.status] || 0) + 1
    const labels = currentLang === 'en'
      ? { planned: 'Planned', in_progress: 'In Progress', waiting: 'Waiting', done: 'Done' }
      : { planned: 'Tervezett', in_progress: 'Folyamatban', waiting: 'Várakozik', done: 'Kész' }
    const el = document.getElementById('homeKanban')
    el.innerHTML = Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `<div class="home-kanban-row"><div class="home-kanban-dot ${k}"></div><span>${labels[k]}</span><span class="home-kanban-count">${v}</span></div>`)
      .join('') || `<div class="home-empty">${t('Nincs kártya')}</div>`
  } catch {
    document.getElementById('homeKanban').innerHTML = `<div class="home-empty">${t('Nem sikerült betölteni')}</div>`
  }

  // Daily log (today, last 3 entries)
  try {
    const today = new Date().toISOString().split('T')[0]
    const res = await fetch(`/api/daily-log?agent=nova&date=${today}`)
    const entries = await res.json()
    const el = document.getElementById('homeDaily')
    if (!entries || entries.length === 0) {
      el.innerHTML = `<div class="home-empty">${t('Ma még nincs bejegyzés')}</div>`
    } else {
      el.innerHTML = entries.slice(-3).map(e => {
        const preview = e.content.replace(/^##\s*/gm, '').replace(/\n/g, ' ').slice(0, 150)
        return `<div class="home-daily-entry">${escapeHtml(preview)}${e.content.length > 150 ? '...' : ''}</div>`
      }).join('')
    }
  } catch {
    document.getElementById('homeDaily').innerHTML = `<div class="home-empty">${t('Nem sikerült betölteni')}</div>`
  }
}

// URL hash routing
const validPages = [...navLinks].map(l => l.dataset.page)
function handleHashRoute() {
  const hash = window.location.hash.replace('#', '')
  if (hash && validPages.includes(hash)) {
    switchPage(hash, false)
  } else {
    switchPage('home', false)
  }
}
window.addEventListener('hashchange', handleHashRoute)
handleHashRoute()

// === Nav hamburger toggle ===
const navToggle = document.getElementById('navToggle')
if (navToggle) {
  const nav = document.querySelector('nav[role="navigation"]')
  navToggle.addEventListener('click', () => {
    if (nav) nav.classList.toggle('open')
  })
  // ux #9: oldal-váltáskor (nav link click) zárjuk a menüt, ne ragadjon nyitva
  if (nav) {
    nav.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => nav.classList.remove('open'))
    })
  }
}

// ============================================================
// === Kanban ===
// ============================================================

let novaAvatarVersion = 0
let kanbanCards = []
let kanbanAssignees = []

const cardModalOverlay = document.getElementById('cardModalOverlay')
const cardDetailOverlay = document.getElementById('cardDetailOverlay')
const columns = document.querySelectorAll('.kanban-col-body')

// Modal wiring
document.getElementById('cardModalClose').addEventListener('click', () => closeModal(cardModalOverlay))
document.getElementById('cardDetailClose').addEventListener('click', () => closeModal(cardDetailOverlay))
cardModalOverlay.addEventListener('click', (e) => { if (e.target === cardModalOverlay) closeModal(cardModalOverlay) })
cardDetailOverlay.addEventListener('click', (e) => { if (e.target === cardDetailOverlay) closeModal(cardDetailOverlay) })

// Add card buttons per column
document.querySelectorAll('.kanban-add-btn').forEach((btn) => {
  btn.addEventListener('click', () => openNewCardModal(btn.dataset.status))
})

async function loadKanban() {
  renderKanbanSkeleton()
  try {
    const [cardsRes, assigneesRes] = await Promise.all([
      fetch('/api/kanban'),
      fetch('/api/kanban/assignees'),
    ])
    kanbanCards = await cardsRes.json()
    kanbanAssignees = await assigneesRes.json()
    renderKanban()
  } catch (err) {
    console.error('Kanban betöltés hiba:', err)
  }
}

function renderKanbanSkeleton() {
  const counts = { planned: 2, in_progress: 3, waiting: 1, done: 2 }
  for (const [status, n] of Object.entries(counts)) {
    const col = document.querySelector(`.kanban-col-body[data-status="${status}"]`)
    if (!col) continue
    col.innerHTML = ""
    for (let i = 0; i < n; i++) {
      const card = document.createElement("div")
      card.className = "kanban-skeleton-card"
      card.setAttribute("aria-hidden", "true")
      card.innerHTML = `<div class="kanban-skeleton-line medium"></div><div class="kanban-skeleton-line short"></div>`
      col.appendChild(card)
    }
  }
}

function renderKanban() {
  const grouped = { planned: [], in_progress: [], waiting: [], done: [] }
  for (const card of kanbanCards) {
    if (grouped[card.status]) grouped[card.status].push(card)
  }

  for (const [status, cards] of Object.entries(grouped)) {
    const col = document.querySelector(`.kanban-col-body[data-status="${status}"]`)
    col.innerHTML = ''
    cards.sort((a, b) => a.sort_order - b.sort_order)

    for (const card of cards) {
      col.appendChild(createCardEl(card))
    }
  }

  // Update counts
  document.getElementById('countPlanned').textContent = grouped.planned.length
  document.getElementById('countInProgress').textContent = grouped.in_progress.length
  document.getElementById('countWaiting').textContent = grouped.waiting.length
  document.getElementById('countDone').textContent = grouped.done.length
}

function createCardEl(card) {
  const el = document.createElement('div')
  el.className = 'kanban-card'
  el.dataset.id = card.id
  el.dataset.priority = card.priority
  el.draggable = true

  const assignee = card.assignee ? kanbanAssignees.find((a) => a.name === card.assignee) : null
  const assigneeHtml = assignee
    ? `<span class="kanban-card-assignee"><span class="assignee-dot ${assignee.type}">${assignee.name[0]}</span>${escapeHtml(assignee.name)}</span>`
    : ''

  let dueHtml = ''
  if (card.due_date) {
    const d = new Date(card.due_date * 1000)
    const now = new Date()
    const overdue = d < now && card.status !== 'done'
    const label = d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })
    dueHtml = `<span class="kanban-card-due ${overdue ? 'overdue' : ''}">${label}</span>`
  }

  let labelsHtml = ''
  if (card.labels) {
    const labelColors = { tech: '#3b82f6', üzlet: '#10b981', sürgős: '#ef4444', ötlet: '#8b5cf6', fejlesztés: '#f59e0b' }
    labelsHtml = card.labels.split(',').map(l => l.trim()).filter(Boolean).map(l =>
      `<span class="kanban-label" style="background:${labelColors[l.toLowerCase()] || '#6b7280'}">${escapeHtml(l)}</span>`
    ).join('')
    labelsHtml = `<div class="kanban-card-labels">${labelsHtml}</div>`
  }

  let blockedHtml = ''
  if (card.blocked_by && card.status !== 'done') {
    const blockerIds = card.blocked_by.split(',').map(s => s.trim()).filter(Boolean)
    const allCards = kanbanCards || []
    const unresolvedBlockers = blockerIds.filter(bid => {
      const blocker = allCards.find(c => c.id === bid)
      return !blocker || blocker.status !== 'done'
    })
    if (unresolvedBlockers.length > 0) {
      blockedHtml = `<div class="kanban-card-blocked">🔒 Blokkolt (${unresolvedBlockers.length})</div>`
      el.classList.add('blocked')
    }
  }

  el.innerHTML = `
    ${labelsHtml}
    <div class="kanban-card-title">${escapeHtml(card.title)}</div>
    ${blockedHtml}
    <div class="kanban-card-footer">${assigneeHtml}${dueHtml}</div>
  `

  // Drag events
  el.addEventListener('dragstart', (e) => {
    el.classList.add('dragging')
    e.dataTransfer.setData('text/plain', card.id)
    e.dataTransfer.effectAllowed = 'move'
  })
  el.addEventListener('dragend', () => el.classList.remove('dragging'))

  // Click -> detail
  el.addEventListener('click', () => showCardDetail(card))

  return el
}

// === Drag & Drop ===
columns.forEach((col) => {
  col.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    col.classList.add('drag-over')

    // Insert indicator position
    const afterEl = getDragAfterElement(col, e.clientY)
    const dragging = document.querySelector('.kanban-card.dragging')
    if (!dragging) return
    if (afterEl) {
      col.insertBefore(dragging, afterEl)
    } else {
      col.appendChild(dragging)
    }
  })

  col.addEventListener('dragleave', (e) => {
    if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over')
  })

  col.addEventListener('drop', async (e) => {
    e.preventDefault()
    col.classList.remove('drag-over')
    const cardId = e.dataTransfer.getData('text/plain')
    const newStatus = col.dataset.status

    // Calculate sort_order based on position
    const cards = [...col.querySelectorAll('.kanban-card')]
    const idx = cards.findIndex((c) => c.dataset.id === cardId)
    let sortOrder = idx

    try {
      await fetch(`/api/kanban/${encodeURIComponent(cardId)}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, sort_order: sortOrder }),
      })
      loadKanban()
    } catch {
      showToast(t('Hiba az áthelyezés során'), 3000, 'error')
    }
  })
})

function getDragAfterElement(col, y) {
  const els = [...col.querySelectorAll('.kanban-card:not(.dragging)')]
  let closest = null
  let closestOffset = Number.NEGATIVE_INFINITY

  for (const el of els) {
    const box = el.getBoundingClientRect()
    const offset = y - box.top - box.height / 2
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset
      closest = el
    }
  }
  return closest
}

// === New card modal ===
function openNewCardModal(status) {
  document.getElementById('cardModalTitle').textContent = t('Új kártya')
  document.getElementById('cardTitle').value = ''
  document.getElementById('cardDesc').value = ''
  document.getElementById('cardPriority').value = 'normal'
  document.getElementById('cardDue').value = ''
  document.getElementById('cardLabels').value = ''
  document.getElementById('cardBlockedBy').value = ''
  document.getElementById('cardEditId').value = ''
  document.getElementById('cardEditStatus').value = status || 'planned'
  populateAssigneeSelect('cardAssignee')
  openModal(cardModalOverlay)
  setTimeout(() => document.getElementById('cardTitle').focus(), 200)
}

function populateAssigneeSelect(selectId, selected) {
  const sel = document.getElementById(selectId)
  sel.innerHTML = `<option value="">${t('-- Nincs --')}</option>`
  for (const a of kanbanAssignees) {
    const opt = document.createElement('option')
    opt.value = a.name
    opt.textContent = a.name
    if (selected && a.name === selected) opt.selected = true
    sel.appendChild(opt)
  }
}

// Save card (create or update)
document.getElementById('saveCardBtn').addEventListener('click', async () => {
  const title = document.getElementById('cardTitle').value.trim()
  if (!title) { document.getElementById('cardTitle').focus(); return }

  const data = {
    title,
    description: document.getElementById('cardDesc').value.trim() || null,
    assignee: document.getElementById('cardAssignee').value || null,
    priority: document.getElementById('cardPriority').value,
    due_date: document.getElementById('cardDue').value
      ? Math.floor(new Date(document.getElementById('cardDue').value).getTime() / 1000)
      : null,
    labels: document.getElementById('cardLabels').value.trim() || null,
    blocked_by: document.getElementById('cardBlockedBy').value.trim() || null,
  }

  const editId = document.getElementById('cardEditId').value

  try {
    if (editId) {
      await fetch(`/api/kanban/${encodeURIComponent(editId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      showToast(t('Kártya frissítve'), 3000, 'success')
    } else {
      data.status = document.getElementById('cardEditStatus').value
      await fetch('/api/kanban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      showToast(t('Kártya létrehozva'), 3000, 'success')
    }
    closeModal(cardModalOverlay)
    loadKanban()
  } catch (err) {
    showToast(t('Hiba a mentés során'), 3000, 'error')
  }
})

// === Card detail ===
async function showCardDetail(card) {
  document.getElementById('cardDetailTitle').textContent = card.title

  const assignee = card.assignee ? kanbanAssignees.find((a) => a.name === card.assignee) : null
  const priorityLabels = { low: t('Alacsony'), normal: t('Normál'), high: t('Magas'), urgent: t('Sürgős') }
  const statusLabels = { planned: t('Tervezett'), in_progress: t('Folyamatban'), waiting: t('Várakozik'), done: t('Kész') }

  const meta = document.getElementById('cardDetailMeta')
  meta.innerHTML = `
    <div class="meta-item">
      <span class="meta-label">${currentLang === 'en' ? 'Status' : 'Állapot'}</span>
      <span class="meta-value">${statusLabels[card.status] || card.status}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">${t('Felelős')}</span>
      <span class="meta-value">${assignee ? escapeHtml(assignee.name) : t('-- Nincs --')}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">${t('Prioritás')}</span>
      <span class="meta-value">${priorityLabels[card.priority]}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">${t('Határidő')}</span>
      <span class="meta-value">${card.due_date ? new Date(card.due_date * 1000).toLocaleDateString(currentLang === 'en' ? 'en-US' : 'hu-HU') : t('-- Nincs --')}</span>
    </div>
    ${card.labels ? `<div class="meta-item">
      <span class="meta-label">${t('Címkék')}</span>
      <span class="meta-value">${card.labels.split(',').map(l => l.trim()).filter(Boolean).map(l => `<span class="kanban-label" style="background:${({tech:'#3b82f6',üzlet:'#10b981',sürgős:'#ef4444',ötlet:'#8b5cf6',fejlesztés:'#f59e0b'})[l.toLowerCase()]||'#6b7280'}">${escapeHtml(l)}</span>`).join(' ')}</span>
    </div>` : ''}
    ${card.blocked_by ? `<div class="meta-item">
      <span class="meta-label">Blokkolja</span>
      <span class="meta-value" style="color:var(--danger)">🔒 ${escapeHtml(String(card.blocked_by))}</span>
    </div>` : ''}
  `

  document.getElementById('cardDetailDesc').textContent = card.description || ''

  // Load comments
  try {
    const res = await fetch(`/api/kanban/${encodeURIComponent(card.id)}/comments`)
    const comments = await res.json()
    const list = document.getElementById('commentsList')
    list.innerHTML = ''
    for (const c of comments) {
      const date = new Date(c.created_at * 1000).toLocaleString('hu-HU')
      const div = document.createElement('div')
      div.className = 'comment-item'
      div.innerHTML = `
        <div><span class="comment-author">${escapeHtml(c.author)}</span><span class="comment-date">${date}</span></div>
        <div class="comment-body">${escapeHtml(c.content)}</div>
      `
      list.appendChild(div)
    }
  } catch { /* ignore */ }

  // Author select for new comment
  populateAssigneeSelect('commentAuthor', 'Nova')

  // Add comment
  document.getElementById('addCommentBtn').onclick = async () => {
    const content = document.getElementById('commentContent').value.trim()
    const author = document.getElementById('commentAuthor').value
    if (!content || !author) return
    try {
      await fetch(`/api/kanban/${encodeURIComponent(card.id)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, content }),
      })
      document.getElementById('commentContent').value = ''
      showCardDetail(card) // refresh
    } catch {
      showToast(t('Hiba a megjegyzés mentése során'), 3000, 'error')
    }
  }

  // Edit button
  document.getElementById('cardEditBtn').onclick = () => {
    closeModal(cardDetailOverlay)
    document.getElementById('cardModalTitle').textContent = t('Kártya szerkesztése')
    document.getElementById('cardTitle').value = card.title
    document.getElementById('cardDesc').value = card.description || ''
    document.getElementById('cardPriority').value = card.priority
    document.getElementById('cardDue').value = card.due_date
      ? new Date(card.due_date * 1000).toISOString().split('T')[0]
      : ''
    document.getElementById('cardEditId').value = card.id
    document.getElementById('cardEditStatus').value = card.status
    document.getElementById('cardLabels').value = card.labels || ''
    document.getElementById('cardBlockedBy').value = card.blocked_by || ''
    populateAssigneeSelect('cardAssignee', card.assignee)
    openModal(cardModalOverlay)
  }

  // Archive
  document.getElementById('cardArchiveBtn').onclick = async () => {
    try {
      await fetch(`/api/kanban/${encodeURIComponent(card.id)}/archive`, { method: 'POST' })
      closeModal(cardDetailOverlay)
      showToast(t('Kártya archiválva'), 3000, 'success')
      loadKanban()
    } catch {
      showToast(t('Hiba az archiválás során'), 3000, 'error')
    }
  }

  // Delete
  document.getElementById('cardDeleteBtn').onclick = async () => {
    if (!confirm(t('Biztosan törlöd ezt a kártyát?'))) return
    try {
      await fetch(`/api/kanban/${encodeURIComponent(card.id)}`, { method: 'DELETE' })
      closeModal(cardDetailOverlay)
      showToast(t('Kártya törölve'), 3000, 'success')
      loadKanban()
    } catch {
      showToast(t('Hiba a törlés során'), 3000, 'error')
    }
  }

  openModal(cardDetailOverlay)
}

// === Elements: Agents ===
const agentsGrid = document.getElementById('agentsGrid')
const addBtn = document.getElementById('addAgentBtn')
const agentWizardOverlay = document.getElementById('agentWizardOverlay')
const agentDetailOverlay = document.getElementById('agentDetailOverlay')
const skillModalOverlay = document.getElementById('skillModalOverlay')
const agentName = document.getElementById('agentName')
const agentDesc = document.getElementById('agentDesc')
const agentModel = document.getElementById('agentModel')
const toast = document.getElementById('toast')

const AVATARS = [
  '01_robot.png', '02_wizard_girl.png', '03_knight.png', '04_ninja.png',
  '05_pirate.png', '06_scientist_girl.png', '07_astronaut.png', '08_viking.png',
  '09_cowgirl.png', '10_detective.png', '11_chef.png', '12_witch.png',
  '13_samurai.png', '14_fairy_girl.png', '15_firefighter.png', '16_punk_girl.png',
  '17_explorer.png', '18_dj.png', '19_princess.png', '20_alien.png'
]

let selectedAvatar = null
let agents = []
let currentAgent = null
let wizardStep = 1
let generatedClaudeMd = ''
let generatedSoulMd = ''

// === Modal helpers ===
// Focus-trap aware modal helpers (a11y)
let _lastFocusedEl = null
function _focusable(root) {
  return Array.from(root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetParent !== null)
}
function openModal(overlay) {
  if (!overlay) return
  _lastFocusedEl = document.activeElement
  // ARIA: mark inner modal as a dialog (first-time only)
  const inner = overlay.querySelector('.modal')
  if (inner && !inner.getAttribute('role')) {
    inner.setAttribute('role', 'dialog')
    inner.setAttribute('aria-modal', 'true')
    const h = inner.querySelector('h1,h2,h3')
    if (h) {
      if (!h.id) h.id = 'm_' + Math.random().toString(36).slice(2, 8)
      inner.setAttribute('aria-labelledby', h.id)
    }
  }
  overlay.classList.add('active')
  document.body.style.overflow = 'hidden'
  // Focus first focusable inside the modal
  setTimeout(() => {
    const f = _focusable(overlay)
    if (f.length) f[0].focus()
  }, 50)
  if (currentLang !== 'hu') setTimeout(applyTranslations, 50)
}
function closeModal(overlay) {
  if (!overlay) return
  overlay.classList.remove('active')
  // Restore focus if any other modal is still open do nothing; else restore
  const anyOpen = document.querySelectorAll('.modal-overlay.active').length > 0
  if (!anyOpen) {
    document.body.style.overflow = ''
    if (_lastFocusedEl && typeof _lastFocusedEl.focus === 'function') {
      try { _lastFocusedEl.focus() } catch {}
    }
    _lastFocusedEl = null
  }
}
// Focus trap: Tab cycles within the top-most open modal
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return
  const openOverlays = document.querySelectorAll('.modal-overlay.active')
  if (!openOverlays.length) return
  const top = openOverlays[openOverlays.length - 1]
  const focusables = _focusable(top)
  if (!focusables.length) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus()
  }
})

// Wizard open — ha van mentett draft, ajánlja a folytatást
addBtn.addEventListener('click', () => {
  resetWizard()
  openModal(agentWizardOverlay)
  const draft = loadWizardDraft()
  if (draft && (draft.name || draft.description)) {
    const ageMin = Math.round((Date.now() - (draft.savedAt || 0)) / 60000)
    const ageLabel = ageMin < 60 ? `${ageMin} perce` : `${Math.round(ageMin / 60)} órája`
    const label = draft.name ? `"${draft.name}"` : '(névtelen)'
    if (confirm(`📋 Félbehagyott ágens van mentve: ${label} (${ageLabel}).\n\nOK = Folytatás\nMégse = Friss kezdés (a draft eldobódik)`)) {
      applyWizardDraft(draft)
    } else {
      clearWizardDraft()
    }
  }
  setTimeout(() => agentName.focus(), 200)
})

// Wizard bezárás — megerősítés + opcionális draft mentés
// Félbehagyott agent flow: localStorage-ba menti a step 1 form-mezőket, a user
// később folytathatja. Avatar data URL-t NEM mentünk (1-2 MB), csak a
// stílust/prompt-ot — a user újragenerálhatja.
const WIZARD_DRAFT_KEY = 'claudeclaw-wizard-draft'

function wizardHasUserInput() {
  const n = (agentName.value || '').trim()
  const d = (agentDesc.value || '').trim()
  return wizardStep !== 1 || n.length > 0 || d.length > 0 || selectedAvatar !== null
}

function saveWizardDraft() {
  const draft = {
    name: agentName.value || '',
    description: agentDesc.value || '',
    model: agentModel.value || 'inherit',
    profile: (document.getElementById('agentProfile')?.value) || '',
    // selectedAvatar csak ha gallery fájlnév (data URL-t nem mentünk — 1 MB+)
    selectedAvatar: (typeof selectedAvatar === 'string' && !selectedAvatar.startsWith('data:')) ? selectedAvatar : null,
    avatarStyle: (document.getElementById('step1AvatarStyle')?.value) || 'photorealistic',
    avatarPrompt: (document.getElementById('step1AvatarPrompt')?.value) || '',
    savedAt: Date.now(),
  }
  try {
    localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(draft))
    return true
  } catch { return false }
}

function loadWizardDraft() {
  try {
    const raw = localStorage.getItem(WIZARD_DRAFT_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function clearWizardDraft() {
  try { localStorage.removeItem(WIZARD_DRAFT_KEY) } catch { /* ignore */ }
}

function applyWizardDraft(draft) {
  if (!draft) return
  agentName.value = draft.name || ''
  agentDesc.value = draft.description || ''
  agentModel.value = draft.model || 'inherit'
  const profileSel = document.getElementById('agentProfile')
  if (profileSel && draft.profile !== undefined) {
    profileSel.value = draft.profile
    profileSel.dispatchEvent(new Event('change'))
  }
  if (draft.selectedAvatar) {
    selectedAvatar = draft.selectedAvatar
    // Gallery item highlight
    document.querySelectorAll('#avatarGrid .avatar-grid-item').forEach(item => {
      if (item.dataset.avatar === draft.selectedAvatar) item.classList.add('selected')
    })
  }
  const styleSel = document.getElementById('step1AvatarStyle')
  if (styleSel && draft.avatarStyle) styleSel.value = draft.avatarStyle
  const promptInput = document.getElementById('step1AvatarPrompt')
  if (promptInput && draft.avatarPrompt) promptInput.value = draft.avatarPrompt
  updateAgentNamePreview()
}

async function closeWizardSafe() {
  if (!wizardHasUserInput()) {
    clearWizardDraft()
    closeModal(agentWizardOverlay)
    return
  }
  if (wizardStep !== 1) {
    // Step 2/3: agent már létrejött (vagy épp generálódik), draft nem alkalmas
    const choice = prompt(
      'Az ágens már létrejött a backend-en. Mit szeretnél?\n' +
      '1 = Törlés (az ágens mappája eltűnik)\n' +
      '2 = Megtartás (review elveszik, de az ágens marad a Csapat oldalon)\n' +
      'Üres = Mégse (maradj itt)',
      '2'
    )
    if (choice === null || choice.trim() === '') return  // Mégse
    if (choice.trim() === '1') {
      const name = agentName.value.trim()
      if (name) {
        try {
          const res = await fetch(`/api/agents/${encodeURIComponent(name)}`, { method: 'DELETE' })
          if (res.ok) showToast('Ágens törölve', 2000, 'success')
        } catch (err) {
          showToast('Törlés hiba: ' + err.message, 3000, 'error')
        }
      }
      clearWizardDraft()
      closeModal(agentWizardOverlay)
    } else if (choice.trim() === '2') {
      clearWizardDraft()
      closeModal(agentWizardOverlay)
    }
    // Bármi más → interpretáljuk mint Mégse (maradj)
    return
  }
  // Step 1: 3-state choice (prompt → save | discard | cancel)
  const choice = prompt(
    'Mit szeretnél?\n' +
    '1 = Mentés draftként (később folytatható)\n' +
    '2 = Eldobás (adatok elvesznek)\n' +
    'Üres = Mégse (maradj itt)',
    '1'
  )
  if (choice === null || choice.trim() === '') return  // Mégse
  if (choice.trim() === '1') {
    if (saveWizardDraft()) showToast('Draft mentve — újraranyitáskor folytathatod', 3000, 'success')
    closeModal(agentWizardOverlay)
  } else if (choice.trim() === '2') {
    clearWizardDraft()
    closeModal(agentWizardOverlay)
  }
  // Bármi más → interpretáljuk mint Mégse (maradj)
}

// Close buttons
document.getElementById('wizardClose').addEventListener('click', closeWizardSafe)
document.getElementById('agentDetailClose').addEventListener('click', () => closeModal(agentDetailOverlay))
document.getElementById('skillModalClose').addEventListener('click', () => closeModal(skillModalOverlay))
const skillDetailOverlay = document.getElementById('agentSkillDetailOverlay')
document.getElementById('agentSkillDetailClose').addEventListener('click', () => closeModal(document.getElementById('agentSkillDetailOverlay')))

// Click-outside-to-close (wizard-nek megerősítés, többinek azonnali)
agentWizardOverlay.addEventListener('click', (e) => { if (e.target === agentWizardOverlay) closeWizardSafe() })
agentDetailOverlay.addEventListener('click', (e) => { if (e.target === agentDetailOverlay) closeModal(agentDetailOverlay) })
skillModalOverlay.addEventListener('click', (e) => { if (e.target === skillModalOverlay) closeModal(skillModalOverlay) })
skillDetailOverlay.addEventListener('click', (e) => { if (e.target === skillDetailOverlay) closeModal(skillDetailOverlay) })
const _agentSkillDetailOverlay = document.getElementById('agentSkillDetailOverlay')
if (_agentSkillDetailOverlay) _agentSkillDetailOverlay.addEventListener('click', (e) => { if (e.target === _agentSkillDetailOverlay) closeModal(_agentSkillDetailOverlay) })

// Close all modals on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach((o) => closeModal(o))
  }
})

// === Avatar Gallery ===
function populateAvatarGrid() {
  const grid = document.getElementById('avatarGrid')
  grid.innerHTML = ''
  for (const avatar of AVATARS) {
    const item = document.createElement('div')
    item.className = 'avatar-grid-item'
    item.dataset.avatar = avatar
    item.innerHTML = `<img src="/avatars/${avatar}" alt="${avatar.replace(/^\d+_/, '').replace('.png', '')}">`
    item.addEventListener('click', () => {
      grid.querySelectorAll('.avatar-grid-item').forEach(i => i.classList.remove('selected'))
      item.classList.add('selected')
      selectedAvatar = avatar
    })
    grid.appendChild(item)
  }
}

// === Wizard logic ===

// Profilok cache — listProfiles() eredménye, egyszer töltődik be
let cachedProfiles = null

// === Template Editor modal (CRUD a templates/agents/*.json-re) ===
const templateEditorOverlay = document.getElementById('templateEditorOverlay')
let templateEditMode = 'new'  // 'new' | 'edit'

async function reloadTemplateList() {
  AGENT_TEMPLATES = []
  await loadAgentTemplates()
  const list = document.getElementById('templateList')
  if (!list) return
  if (AGENT_TEMPLATES.length === 0) {
    list.innerHTML = '<div class="muted">Nincs sablon.</div>'
    return
  }
  list.innerHTML = AGENT_TEMPLATES.map(tpl => `
    <div class="template-list-item" data-id="${escapeHtml(tpl.id)}">
      <span class="template-list-icon">${tpl.icon || '🎭'}</span>
      <div class="template-list-body">
        <div class="template-list-label">${escapeHtml(tpl.label || tpl.id)}</div>
        <div class="template-list-id muted">${escapeHtml(tpl.id)}</div>
      </div>
      <button type="button" class="btn-link template-edit-btn">Szerkeszt</button>
    </div>
  `).join('')
  list.querySelectorAll('.template-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.template-list-item').dataset.id
      const tpl = AGENT_TEMPLATES.find(t => t.id === id)
      if (tpl) openTemplateForm('edit', tpl)
    })
  })
}

async function populateTemplateProfileDropdown() {
  // A profile dropdown ugyanazokat a profile-okat használja mint a wizard
  const sel = document.getElementById('templateProfile')
  if (!sel) return
  if (!cachedProfiles) {
    try {
      const res = await fetch('/api/profiles')
      if (res.ok) cachedProfiles = await res.json()
    } catch { cachedProfiles = [] }
  }
  const profiles = Array.isArray(cachedProfiles) ? cachedProfiles : []
  sel.innerHTML = `<option value="">🌐 Univerzális (nincs korlát)</option>` +
    profiles.sort((a, b) => a.label.localeCompare(b.label, 'hu'))
      .map(p => `<option value="${escapeHtml(p.id)}">${profileIcon(p.id)} ${escapeHtml(p.label)}</option>`).join('')
}

function openTemplateForm(mode, tpl) {
  templateEditMode = mode
  document.getElementById('templateFormCol').hidden = false
  const idInput = document.getElementById('templateId')
  if (mode === 'edit' && tpl) {
    idInput.value = tpl.id
    idInput.disabled = true  // ID nem módosítható (fájlnév)
    document.getElementById('templateIcon').value = tpl.icon || ''
    document.getElementById('templateLabel').value = tpl.label || ''
    document.getElementById('templateName').value = tpl.name || ''
    document.getElementById('templateDescription').value = tpl.description || ''
    document.getElementById('templateProfile').value = tpl.profile || ''
    document.getElementById('templateModel').value = tpl.model || 'inherit'
    document.getElementById('templateAvatarStyle').value = tpl.avatarStyle || 'photorealistic'
    document.getElementById('templateDeleteBtn').hidden = false
  } else {
    idInput.value = ''
    idInput.disabled = false
    document.getElementById('templateIcon').value = ''
    document.getElementById('templateLabel').value = ''
    document.getElementById('templateName').value = ''
    document.getElementById('templateDescription').value = ''
    document.getElementById('templateProfile').value = ''
    document.getElementById('templateModel').value = 'inherit'
    document.getElementById('templateAvatarStyle').value = 'photorealistic'
    document.getElementById('templateDeleteBtn').hidden = true
  }
}

async function saveTemplate() {
  const id = document.getElementById('templateId').value.trim()
  const data = {
    id,
    icon: document.getElementById('templateIcon').value.trim(),
    label: document.getElementById('templateLabel').value.trim(),
    name: document.getElementById('templateName').value.trim(),
    description: document.getElementById('templateDescription').value.trim(),
    profile: document.getElementById('templateProfile').value,
    model: document.getElementById('templateModel').value,
    avatarStyle: document.getElementById('templateAvatarStyle').value,
  }
  if (!id || !/^[a-z0-9][a-z0-9_-]{0,40}$/i.test(id)) {
    showToast('Érvénytelen ID (csak ASCII, max 40 karakter)', 3000, 'error')
    return
  }
  if (!data.label || !data.name || !data.description) {
    showToast('Cím + Auto-név + Leírás kötelező', 3000, 'error')
    return
  }
  try {
    const res = await fetch('/api/agent-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const body = await res.json()
    if (!res.ok) {
      showToast('Hiba: ' + (body.error || '?'), 3000, 'error')
      return
    }
    showToast('Sablon mentve ✓', 2000, 'success')
    document.getElementById('templateFormCol').hidden = true
    await reloadTemplateList()
    // A wizard sablon listát is frissítsük, ha nyitva van
    renderAgentTemplates()
  } catch (err) {
    showToast('Hálózati hiba: ' + err.message, 3000, 'error')
  }
}

async function deleteTemplate() {
  const id = document.getElementById('templateId').value.trim()
  if (!id) return
  if (!confirm(`Törlöd a "${id}" sablont?`)) return
  try {
    const res = await fetch(`/api/agent-templates/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) {
      const b = await res.json()
      showToast('Hiba: ' + (b.error || '?'), 3000, 'error')
      return
    }
    showToast('Sablon törölve', 2000, 'success')
    document.getElementById('templateFormCol').hidden = true
    await reloadTemplateList()
    renderAgentTemplates()
  } catch (err) {
    showToast('Hálózati hiba: ' + err.message, 3000, 'error')
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('openTemplateEditor')
  const closeBtn = document.getElementById('templateEditorClose')
  const newBtn = document.getElementById('templateNewBtn')
  const saveBtn = document.getElementById('templateSaveBtn')
  const cancelBtn = document.getElementById('templateCancelBtn')
  const deleteBtn = document.getElementById('templateDeleteBtn')
  if (openBtn) openBtn.addEventListener('click', async () => {
    await populateTemplateProfileDropdown()
    await reloadTemplateList()
    document.getElementById('templateFormCol').hidden = true
    openModal(templateEditorOverlay)
  })
  if (closeBtn) closeBtn.addEventListener('click', () => closeModal(templateEditorOverlay))
  if (templateEditorOverlay) templateEditorOverlay.addEventListener('click', (e) => {
    if (e.target === templateEditorOverlay) closeModal(templateEditorOverlay)
  })
  if (newBtn) newBtn.addEventListener('click', () => openTemplateForm('new', null))
  if (saveBtn) saveBtn.addEventListener('click', saveTemplate)
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    document.getElementById('templateFormCol').hidden = true
  })
  if (deleteBtn) deleteBtn.addEventListener('click', deleteTemplate)
})

// Gyors agent sablonok — dinamikusan töltődik a /api/agent-templates-ből
// (templates/agents/*.json). Owner bővítheti új sablonokkal, és azok
// automatikusan megjelennek a dropdown-ban.
let AGENT_TEMPLATES = []
async function loadAgentTemplates() {
  try {
    const res = await fetch('/api/agent-templates')
    if (res.ok) AGENT_TEMPLATES = await res.json()
  } catch {
    AGENT_TEMPLATES = []
  }
}

// Profil ID → emoji mapping (F — vizuális hint a dropdownban és description-ben)
const PROFILE_ICONS = {
  '': '🌐',                   // univerzális
  'default': '🔓',             // nincs korlát
  'developer-junior': '👨‍💻',   // sandboxolt fejlesztő
  'developer-senior': '🛠️',    // bizalmi fejlesztő
  'marketer': '📧',            // email/social
  'researcher': '🔍',          // web olvasó
  'coach': '🏋️',               // edző / trainer (ha létrehozzuk későbbi profilban)
  'assistant': '🤝',           // asszisztens
}

function profileIcon(id) {
  return PROFILE_ICONS[id] || '🎭'
}

async function loadProfilesIntoDropdown() {
  const sel = document.getElementById('agentProfile')
  const help = document.getElementById('agentProfileHelp')
  if (!sel) return
  if (!cachedProfiles) {
    try {
      const res = await fetch('/api/profiles')
      if (res.ok) cachedProfiles = await res.json()
    } catch {
      cachedProfiles = []
    }
  }
  // Univerzális opció MINDIG elérhető (üres érték → backend nem kap profile mezőt,
  // maradéknak a meglévő wildcard permissions jut — ezt használja pl. személyi
  // edző agent ami se fejlesztő, se marketinges).
  const universalOption = {
    id: '',
    label: 'Univerzális (nincs korlát)',
    description: 'Teljes hozzáférés, mint a meglévő Nova/Zara. Akkor válaszd ha az agent nem fér bele egy szerep-specifikus sablonba (pl. személyi edző, asszisztens, háztartási tervező).'
  }
  const profiles = [universalOption, ...(Array.isArray(cachedProfiles) ? cachedProfiles : [])]
  // default ELSŐ (a univerzális után), aztán ABC-ben
  const sorted = [
    universalOption,
    ...profiles.filter(p => p.id !== '').sort((a, b) => {
      if (a.id === 'default') return -1
      if (b.id === 'default') return 1
      return a.label.localeCompare(b.label, 'hu')
    })
  ]
  sel.innerHTML = sorted.map(p =>
    `<option value="${escapeHtml(p.id)}">${profileIcon(p.id)} ${escapeHtml(p.label)}</option>`
  ).join('')
  sel.value = ''  // Univerzális alapértelmezett — backward compat + user-friendly
  // Leírás frissítés + change hook
  const updateHelp = () => {
    const p = sorted.find(x => x.id === sel.value)
    if (help) help.textContent = p?.description || ''
  }
  sel.onchange = updateHelp
  updateHelp()
}

// Client-side agent name sanitizer — tükrözi a backend src/utils/sanitize.ts-t
// (NFD normalizálás + diakritika szűrés + ASCII filter). Így a user valós
// időben látja mi lesz az ID (pl. "Személyi edző" → "szemelyi-edzo").
function sanitizeAgentNameClient(raw) {
  return (raw || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

// Név preview + ütközés ellenőrzés
let _agentNameCheckTimer = null
async function updateAgentNamePreview() {
  const input = document.getElementById('agentName')
  const help = document.getElementById('agentNameHelp')
  if (!input || !help) return
  const raw = input.value
  const sanitized = sanitizeAgentNameClient(raw)
  if (!sanitized) {
    help.innerHTML = ''
    return
  }
  // Azonnali preview
  const prefix = raw !== sanitized
    ? `ID: <code>${escapeHtml(sanitized)}</code> (az ékezetek + speciális karakterek átalakítva)`
    : `ID: <code>${escapeHtml(sanitized)}</code>`
  help.innerHTML = prefix + ' · <span class="muted">ellenőrzés…</span>'
  // Debounce 350ms → majd API lekérés
  clearTimeout(_agentNameCheckTimer)
  _agentNameCheckTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(sanitized)}`)
      if (res.ok) {
        help.innerHTML = prefix + ` · <span style="color:var(--danger)">⚠️ már létezik</span>`
      } else if (res.status === 404) {
        help.innerHTML = prefix + ` · <span style="color:var(--success,#10b981)">✓ szabad</span>`
      } else {
        help.innerHTML = prefix
      }
    } catch {
      help.innerHTML = prefix
    }
  }, 350)
}

async function renderAgentTemplates() {
  const container = document.getElementById('agentTemplates')
  if (!container) return
  if (AGENT_TEMPLATES.length === 0) await loadAgentTemplates()
  if (AGENT_TEMPLATES.length === 0) {
    container.innerHTML = '<span class="muted">Nincs elérhető sablon. Hozz létre új fájlt a <code>templates/agents/</code> mappában.</span>'
    return
  }
  container.innerHTML = AGENT_TEMPLATES.map((tpl, idx) => `
    <button type="button" class="agent-template-btn" data-idx="${idx}" title="${escapeHtml((tpl.description || '').slice(0, 100))}…">
      <span class="agent-template-icon">${tpl.icon || '🎭'}</span>
      <span class="agent-template-label">${escapeHtml(tpl.label || tpl.id || 'sablon')}</span>
    </button>
  `).join('')
  container.querySelectorAll('.agent-template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10)
      const tpl = AGENT_TEMPLATES[idx]
      if (!tpl) return
      agentName.value = tpl.name || tpl.id || ''
      agentDesc.value = tpl.description || ''
      if (tpl.model) agentModel.value = tpl.model
      const profileSel = document.getElementById('agentProfile')
      if (profileSel && tpl.profile !== undefined) {
        profileSel.value = tpl.profile
        profileSel.dispatchEvent(new Event('change'))
      }
      // Ha a sablonban van avatarStyle, előre beállítjuk a step 1 AI dropdownt
      const styleSel = document.getElementById('step1AvatarStyle')
      if (styleSel && tpl.avatarStyle) styleSel.value = tpl.avatarStyle
      updateAgentNamePreview()
      // Visual feedback
      container.querySelectorAll('.agent-template-btn').forEach(b => b.classList.remove('selected'))
      btn.classList.add('selected')
    })
  })
}

function resetWizard() {
  wizardStep = 1
  agentName.value = ''
  agentDesc.value = ''
  agentModel.value = 'inherit'
  selectedAvatar = null
  document.querySelectorAll('#avatarGrid .avatar-grid-item').forEach(i => i.classList.remove('selected'))
  document.querySelectorAll('#agentTemplates .agent-template-btn').forEach(b => b.classList.remove('selected'))
  // Step 1 AI avatar preview reset
  const aiResult = document.getElementById('step1AvatarResult')
  if (aiResult) { aiResult.hidden = true; aiResult.classList.remove('selected') }
  const aiPreview = document.getElementById('step1AvatarPreview')
  if (aiPreview) aiPreview.src = ''
  const aiPromptInput = document.getElementById('step1AvatarPrompt')
  if (aiPromptInput) aiPromptInput.value = ''
  generatedClaudeMd = ''
  generatedSoulMd = ''
  document.getElementById('wizardClaudeMd').value = ''
  document.getElementById('wizardSoulMd').value = ''
  const nameHelp = document.getElementById('agentNameHelp')
  if (nameHelp) nameHelp.innerHTML = ''
  // Sablonok + profilok betöltése
  renderAgentTemplates()
  loadProfilesIntoDropdown()
  updateWizardUI()
}

// Név input listener — preview + collision check
document.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('agentName')
  if (nameInput) nameInput.addEventListener('input', updateAgentNamePreview)
})

// 💡 Név ötletek AI generálás — a leírás alapján 6 magyar név
async function suggestNames() {
  const btn = document.getElementById('suggestNamesBtn')
  const box = document.getElementById('nameSuggestions')
  if (!btn || !box) return
  const desc = agentDesc.value.trim()
  if (!desc) {
    showToast('Előbb írd le mit csináljon az agent, aztán jövök ötletekkel', 3000, 'info')
    agentDesc.focus()
    return
  }
  btn.disabled = true
  const originalText = btn.textContent
  btn.textContent = '💭 Gondolkodom…'
  try {
    const res = await fetch('/api/agents/name-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc, count: 6 }),
    })
    const data = await res.json()
    if (!res.ok || !Array.isArray(data.suggestions)) {
      showToast('Név ötlet hiba: ' + (data.error || 'ismeretlen'), 3000, 'error')
      return
    }
    if (data.suggestions.length === 0) {
      showToast('Nincs javaslat — próbálj részletesebb leírást', 3000, 'info')
      return
    }
    box.innerHTML = data.suggestions.map(n =>
      `<button type="button" class="name-suggestion-chip" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`
    ).join('')
    box.hidden = false
    box.querySelectorAll('.name-suggestion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        agentName.value = chip.dataset.name
        updateAgentNamePreview()
        box.hidden = true
      })
    })
  } catch (err) {
    showToast('Hálózati hiba: ' + err.message, 3000, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = originalText
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('suggestNamesBtn')
  if (btn) btn.addEventListener('click', suggestNames)
})

// Step 1 Avatar AI preview — nincs még agent, data URL-t ad vissza
// A user megnézheti, újra próbálhatja, és "Ezt használom"-ra selectedAvatar-ba
// kerül a data URL. Create agent flow multipart-ként feltölti.
async function step1GenerateAvatarPreview() {
  const btn = document.getElementById('step1GenerateAvatarBtn')
  const resultBox = document.getElementById('step1AvatarResult')
  const previewImg = document.getElementById('step1AvatarPreview')
  const styleSel = document.getElementById('step1AvatarStyle')
  const promptInput = document.getElementById('step1AvatarPrompt')
  if (!btn) return
  // Loading
  btn.disabled = true
  btn.querySelector('.btn-text').hidden = true
  btn.querySelector('.btn-loading').hidden = false
  try {
    const res = await fetch('/api/avatar/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: agentName.value.trim(),
        description: agentDesc.value.trim(),
        style: styleSel ? styleSel.value : 'photorealistic',
        prompt: promptInput && promptInput.value.trim() ? promptInput.value.trim() : undefined,
      }),
    })
    const data = await res.json()
    if (!res.ok || !data.dataUrl) {
      alert('Avatar generálás hiba: ' + (data.error || 'ismeretlen'))
      return
    }
    previewImg.src = data.dataUrl
    resultBox.hidden = false
    // NEM választjuk automatikusan — a user kattintson "Ezt használom"-ra
  } catch (err) {
    alert('Avatar generálás hiba: ' + (err.message || err))
  } finally {
    btn.disabled = false
    btn.querySelector('.btn-text').hidden = false
    btn.querySelector('.btn-loading').hidden = true
  }
}

function step1UseGeneratedAvatar() {
  const previewImg = document.getElementById('step1AvatarPreview')
  if (!previewImg || !previewImg.src || !previewImg.src.startsWith('data:')) return
  // A selectedAvatar globális váltózó data URL-t is fogadhat (a create flow megismeri)
  selectedAvatar = previewImg.src
  // Gallery kiválasztás törlése + vizuális visszajelzés
  document.querySelectorAll('#avatarGrid .avatar-grid-item').forEach(i => i.classList.remove('selected'))
  const resultBox = document.getElementById('step1AvatarResult')
  if (resultBox) resultBox.classList.add('selected')
  showToast('AI-avatar kiválasztva — step 3-ban véglegesedik', 2500, 'success')
}

document.addEventListener('DOMContentLoaded', () => {
  const genBtn = document.getElementById('step1GenerateAvatarBtn')
  const useBtn = document.getElementById('step1UseAvatarBtn')
  const regenBtn = document.getElementById('step1RegenAvatarBtn')
  if (genBtn) genBtn.addEventListener('click', step1GenerateAvatarPreview)
  if (useBtn) useBtn.addEventListener('click', step1UseGeneratedAvatar)
  if (regenBtn) regenBtn.addEventListener('click', step1GenerateAvatarPreview)
})

// Step 3 Avatar AI generálás (Gemini 2.5 Flash Image / Nano Banana)
async function generateAvatarAI() {
  const btn = document.getElementById('wizardGenerateAvatarBtn')
  const img = document.getElementById('wizardAvatarImg')
  const placeholder = document.getElementById('wizardAvatarPlaceholder')
  if (!btn) return
  const name = sanitizeAgentNameClient(agentName.value)
  if (!name) return
  // Loading state
  btn.disabled = true
  btn.querySelector('.btn-text').hidden = true
  btn.querySelector('.btn-loading').hidden = false
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(name)}/avatar/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),  // üres — backend auto-prompt a CLAUDE.md + név alapján
    })
    const data = await res.json()
    if (!res.ok) {
      alert('Avatar generálás hiba: ' + (data.error || 'ismeretlen'))
      return
    }
    // Cache-bust az img src-ben
    const url = `/api/agents/${encodeURIComponent(name)}/avatar?t=${Date.now()}`
    img.src = url
    img.hidden = false
    if (placeholder) placeholder.hidden = true
  } catch (err) {
    alert('Avatar generálás hiba: ' + (err.message || err))
  } finally {
    btn.disabled = false
    btn.querySelector('.btn-text').hidden = false
    btn.querySelector('.btn-loading').hidden = true
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('wizardGenerateAvatarBtn')
  if (btn) btn.addEventListener('click', generateAvatarAI)
})

// Step 3 megjelenítéskor: ha már van avatar (gallery választás vagy előző generálás), mutassuk
function initStep3AvatarView() {
  const img = document.getElementById('wizardAvatarImg')
  const placeholder = document.getElementById('wizardAvatarPlaceholder')
  if (!img) return
  const name = sanitizeAgentNameClient(agentName.value)
  if (!name) return
  // A backend GET /api/agents/:name/avatar 404-et ad, ha nincs — ez normál
  img.src = `/api/agents/${encodeURIComponent(name)}/avatar?t=${Date.now()}`
  img.onload = () => { img.hidden = false; if (placeholder) placeholder.hidden = true }
  img.onerror = () => { img.hidden = true; if (placeholder) placeholder.hidden = false }
}

// Step 3 permission preview — megjeleníti a generált settings.json allow/deny listát
function renderPermissionPreview(settingsJsonRaw, profileId) {
  const preview = document.getElementById('wizardPermissionPreview')
  const allowList = document.querySelector('#wizardPermAllow ul')
  const denyList = document.querySelector('#wizardPermDeny ul')
  if (!preview || !allowList || !denyList) return
  preview.hidden = false
  let allow = []
  let deny = []
  try {
    const parsed = JSON.parse(settingsJsonRaw || '{}')
    allow = parsed?.permissions?.allow || []
    deny = parsed?.permissions?.deny || []
  } catch { /* ha nem érvényes JSON, üres marad */ }
  const summary = preview.querySelector('summary')
  if (summary) {
    const badge = profileId ? ` · profil: <b>${escapeHtml(profileId)}</b>` : ' · profil: <b>univerzális</b>'
    summary.innerHTML = `🛡️ Biztonsági jogosultságok előnézet${badge} (${allow.length} allow, ${deny.length} deny)`
  }
  allowList.innerHTML = allow.length
    ? allow.map(a => `<li><code>${escapeHtml(a)}</code></li>`).join('')
    : '<li class="muted">(üres)</li>'
  denyList.innerHTML = deny.length
    ? deny.map(d => `<li><code>${escapeHtml(d)}</code></li>`).join('')
    : '<li class="muted">(nincs tiltás)</li>'
}

function updateWizardUI() {
  // Steps indicator
  document.querySelectorAll('#wizardSteps .wizard-step').forEach((s) => {
    const step = parseInt(s.dataset.step)
    s.classList.toggle('active', step === wizardStep)
    s.classList.toggle('done', step < wizardStep)
  })
  // Panels
  document.getElementById('wizardStep1').hidden = wizardStep !== 1
  document.getElementById('wizardStep2').hidden = wizardStep !== 2
  document.getElementById('wizardStep3').hidden = wizardStep !== 3
}

// Step 1 -> Step 2 (generate)
// Step 1 → Step 2: POST agent + AI gen CLAUDE.md/SOUL.md ASYNC. Step 2-n
// közben a user avatar-t választhat (párhuzamos flow). Amikor a AI gen kész,
// engedélyezzük a "Tovább a review-hoz" gombot.
document.getElementById('wizardNextBtn').addEventListener('click', async () => {
  const name = agentName.value.trim()
  const desc = agentDesc.value.trim()
  if (!name) { agentName.focus(); return }
  if (!desc) { agentDesc.focus(); return }

  // Advance to step 2 (avatar pick közben AI gen a háttérben)
  wizardStep = 2
  updateWizardUI()

  // Reset step 2 state
  const step2Next = document.getElementById('wizardStep2NextBtn')
  step2Next.disabled = true
  const txtEl = step2Next.querySelector('.btn-text')
  const loadEl = step2Next.querySelector('.btn-loading')
  if (txtEl) txtEl.hidden = true
  if (loadEl) loadEl.hidden = false

  const banner = document.getElementById('wizardGenBanner')
  const statusEl = document.getElementById('wizardGenStatus')
  statusEl.textContent = 'AI írja a CLAUDE.md + SOUL.md fájlokat… (~30 mp)'
  banner.classList.remove('done', 'error')

  try {
    const agentController = new AbortController()
    setTimeout(() => agentController.abort(), 600000) // 10 min timeout
    const profileSel = document.getElementById('agentProfile')
    const profile = profileSel ? profileSel.value : ''
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: desc,
        model: agentModel.value,
        ...(profile ? { profile } : {}),
      }),
      signal: agentController.signal,
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Ismeretlen hiba')
    }

    // Fetch details
    const detailRes = await fetch(`/api/agents/${encodeURIComponent(name)}`)
    if (detailRes.ok) {
      const detail = await detailRes.json()
      generatedClaudeMd = detail.claudeMd || detail.content || ''
      generatedSoulMd = detail.soulMd || ''
      renderPermissionPreview(detail.settingsJson, detail.profile)
    }

    // AI gen done → enable step 2 Tovább
    statusEl.textContent = '✓ Szöveg kész — válassz avatart és lépj tovább'
    banner.classList.add('done')
    step2Next.disabled = false
    if (txtEl) txtEl.hidden = false
    if (loadEl) loadEl.hidden = true
  } catch (err) {
    statusEl.textContent = `❌ Hiba: ${err.message}`
    banner.classList.add('error')
    showToast(`Hiba: ${err.message}`, 3000, 'error')
    // Gomb disabled marad, user Vissza-val visszaléphet és újrapróbálhat
  }
})

// Step 2 → Step 3: upload avatar (ha van) + review
document.getElementById('wizardStep2NextBtn').addEventListener('click', async () => {
  const name = agentName.value.trim()
  const btn = document.getElementById('wizardStep2NextBtn')
  btn.disabled = true
  try {
    // Upload avatar ha van
    if (selectedAvatar) {
      if (typeof selectedAvatar === 'string' && selectedAvatar.startsWith('data:')) {
        const blob = await (await fetch(selectedAvatar)).blob()
        const form = new FormData()
        form.append('avatar', blob, 'avatar.png')
        await fetch(`/api/agents/${encodeURIComponent(name)}/avatar`, { method: 'POST', body: form })
      } else {
        await fetch(`/api/agents/${encodeURIComponent(name)}/avatar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ galleryAvatar: selectedAvatar }),
        })
      }
    }
    wizardStep = 3
    document.getElementById('wizardClaudeMd').value = generatedClaudeMd
    document.getElementById('wizardSoulMd').value = generatedSoulMd
    initStep3AvatarView()
    updateWizardUI()
  } catch (err) {
    showToast('Avatar upload hiba: ' + err.message, 3000, 'error')
  } finally {
    btn.disabled = false
  }
})

// Step 2 → Step 1 (Vissza): az agent már létrejött a backend-en, kérdezünk + törlünk
document.getElementById('wizardBack1Btn').addEventListener('click', async () => {
  if (!confirm('Az ágens már létrejött a backend-en.\n\nOK = Törlöm és visszalépek step 1-re\nMégse = Maradok step 2-n')) return
  const name = agentName.value.trim()
  if (name) {
    try { await fetch(`/api/agents/${encodeURIComponent(name)}`, { method: 'DELETE' }) } catch {}
  }
  wizardStep = 1
  updateWizardUI()
})

// Step 3 -> back to step 2 (avatar újragondolás; az agent már létezik, nem step 1-re)
document.getElementById('wizardBackBtn').addEventListener('click', () => {
  wizardStep = 2
  updateWizardUI()
})

// Step 3 -> Create (finalize with edits)
document.getElementById('wizardCreateBtn').addEventListener('click', async () => {
  const name = agentName.value.trim()
  const claudeMd = document.getElementById('wizardClaudeMd').value
  const soulMd = document.getElementById('wizardSoulMd').value
  const createBtn = document.getElementById('wizardCreateBtn')

  createBtn.disabled = true
  createBtn.querySelector('.btn-text').hidden = true
  createBtn.querySelector('.btn-loading').hidden = false

  try {
    // Update with edited content
    const res = await fetch(`/api/agents/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claudeMd, soulMd }),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Ismeretlen hiba')
    }

    clearWizardDraft()  // Sikeres létrehozás → a draft többé nem kell
    closeModal(agentWizardOverlay)
    showToast(t('Ágens sikeresen létrehozva!'), 3000, 'success')
    loadAgents()
  } catch (err) {
    showToast(`Hiba: ${err.message}`, 3000, 'error')
  } finally {
    createBtn.disabled = false
    createBtn.querySelector('.btn-text').hidden = false
    createBtn.querySelector('.btn-loading').hidden = true
  }
})

// === Toast ===
function showToast(msg, duration = 3000, type = 'info') {
  toast.textContent = msg
  toast.classList.remove('toast-success', 'toast-error', 'toast-info')
  toast.classList.add('toast-' + type)
  toast.classList.add('visible')
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status')
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite')
  setTimeout(() => toast.classList.remove('visible'), duration)
}

// === Agents API ===
async function loadAgents() {
  try {
    const [agentsRes, novaRes] = await Promise.all([
      fetch('/api/agents'),
      fetch('/api/nova'),
    ])
    agents = await agentsRes.json()
    if (novaRes.ok) {
      window._nova = await novaRes.json()
      if (typeof window._nova?.avatarVersion === "number") novaAvatarVersion = window._nova.avatarVersion
      try {
        const moodRes = await fetch("/api/mood/nova")
        if (moodRes.ok) window._nova.mood = await moodRes.json()
      } catch {}
    }
    renderAgents()
  } catch (err) {
    console.error('Betöltés hiba:', err)
  }
}

let _currentSkillName = null
let _currentSkillIcon = null

async function openSkillDetail(skillName, icon) {
  const endpoint = currentAgent?.role === 'main' ? `/api/nova/skills/${encodeURIComponent(skillName)}` : `/api/agents/${encodeURIComponent(currentAgent.name)}/skills/${encodeURIComponent(skillName)}`
  try {
    const res = await fetch(endpoint)
    if (!res.ok) throw new Error()
    const data = await res.json()
    _currentSkillName = skillName
    _currentSkillIcon = icon
    document.getElementById('agentSkillDetailTitle').textContent = `${icon} ${data.name}`
    document.getElementById('agentSkillDetailContent').textContent = data.content
    // Reset to view mode
    document.getElementById('agentSkillDetailContent').style.display = ''
    document.getElementById('agentSkillDetailTextarea').style.display = 'none'
    document.getElementById('agentSkillEditBtn').style.display = ''
    document.getElementById('agentSkillSaveBtn').style.display = 'none'
    document.getElementById('agentSkillCancelBtn').style.display = 'none'
    openModal(document.getElementById('agentSkillDetailOverlay'))
  } catch {
    showToast(t('Skill nem található'), 3000, 'error')
  }
}

// Skill edit buttons
document.getElementById('agentSkillEditBtn').addEventListener('click', () => {
  const pre = document.getElementById('agentSkillDetailContent')
  const textarea = document.getElementById('agentSkillDetailTextarea')
  textarea.value = pre.textContent
  pre.style.display = 'none'
  textarea.style.display = ''
  document.getElementById('agentSkillEditBtn').style.display = 'none'
  document.getElementById('agentSkillSaveBtn').style.display = ''
  document.getElementById('agentSkillCancelBtn').style.display = ''
})

document.getElementById('agentSkillCancelBtn').addEventListener('click', () => {
  document.getElementById('agentSkillDetailContent').style.display = ''
  document.getElementById('agentSkillDetailTextarea').style.display = 'none'
  document.getElementById('agentSkillEditBtn').style.display = ''
  document.getElementById('agentSkillSaveBtn').style.display = 'none'
  document.getElementById('agentSkillCancelBtn').style.display = 'none'
})

document.getElementById('agentSkillSaveBtn').addEventListener('click', async () => {
  const content = document.getElementById('agentSkillDetailTextarea').value
  const endpoint = currentAgent?.role === 'main'
    ? `/api/nova/skills/${encodeURIComponent(_currentSkillName)}`
    : `/api/agents/${encodeURIComponent(currentAgent.name)}/skills/${encodeURIComponent(_currentSkillName)}`
  try {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    })
    if (!res.ok) throw new Error()
    document.getElementById('agentSkillDetailContent').textContent = content
    document.getElementById('agentSkillDetailContent').style.display = ''
    document.getElementById('agentSkillDetailTextarea').style.display = 'none'
    document.getElementById('agentSkillEditBtn').style.display = ''
    document.getElementById('agentSkillSaveBtn').style.display = 'none'
    document.getElementById('agentSkillCancelBtn').style.display = 'none'
    showToast(t('Skill mentve'), 3000, 'success')
  } catch {
    showToast(t('Mentés sikertelen'), 3000, 'error')
  }
})

async function openNovaDetail() {
  const m = window._nova
  if (!m) return

  // Reuse the agent detail modal for Nova
  currentAgent = { ...m, name: 'nova', claudeMd: '', soulMd: '', mcpJson: '', skills: [] }

  document.getElementById('agentDetailTitle').textContent = 'Nova'
  const avatar = document.getElementById('agentDetailAvatar')
  avatar.className = 'detail-avatar gradient-1'
  avatar.innerHTML = `<img src="/api/nova/avatar?v=${novaAvatarVersion ?? 0}" alt="Nova">`
  document.getElementById('agentDetailName').textContent = 'Nova'
  document.getElementById('agentDetailDesc').textContent = m.description || ''
  document.getElementById('agentDetailModel').textContent = 'claude-opus-4-6'
  document.getElementById('agentDetailTgStatus').innerHTML = `<span class="tg-status"><span class="tg-dot connected"></span>${t('Csatlakozva')}</span>`
  document.getElementById('agentDetailSkillCount').textContent = '-'

  // Process control for Nova - always running, no start/stop
  document.getElementById('processDot').className = 'process-dot running'
  document.getElementById('processLabel').textContent = t('Fut')
  document.getElementById('processUptime').textContent = 'tmux: nova-channels'
  document.getElementById('agentStartBtn').hidden = true
  document.getElementById('agentStopBtn').hidden = true

  // Settings tab - load CLAUDE.md, SOUL.md, .mcp.json + skills
  try {
    const claudeRes = await fetch('/api/nova')
    if (claudeRes.ok) {
      const data = await claudeRes.json()
      if (typeof data.avatarVersion === "number") novaAvatarVersion = data.avatarVersion
      document.getElementById('editClaudeMd').value = data.claudeMd || ''
      document.getElementById('editSoulMd').value = data.soulMd || ''
      document.getElementById('editMcpJson').value = data.mcpJson || '{}'
      // Skills
      if (data.skills && data.skills.length > 0) {
        currentAgent.skills = data.skills
        document.getElementById('agentDetailSkillCount').textContent = data.skills.length
        const listEl = document.getElementById('skillList')
        const emptyEl = document.getElementById('skillEmpty')
        listEl.innerHTML = ''
        emptyEl.hidden = true
        const skillIcons = {
          calendar: '\u{1F4C5}', copywriting: '\u{270D}\uFE0F', 'eskuvo-szerzodes': '\u{1F48D}',
          'selfiebox-szerzodes': '\u{1F4F8}', photography: '\u{1F4F7}', wordpress: '\u{1F310}',
          'seo-audit': '\u{1F50D}', 'seo-content': '\u{1F4DD}', 'email-monitoring': '\u{1F4E7}',
          'image-processing': '\u{1F5BC}\uFE0F', mailerlite: '\u{2709}\uFE0F', hirlevelek: '\u{1F4E8}',
          'n8n-workflow-automation': '\u{2699}\uFE0F', 'pdf-generator': '\u{1F4C4}',
          'excel-xlsx': '\u{1F4CA}', 'billingo-szamla': '\u{1F9FE}', leadek: '\u{1F465}',
          'brave-search': '\u{1F50E}', 'social-media-engine': '\u{1F4F1}',
          'ajanlat-email': '\u{1F4E9}', 'drive-manager': '\u{1F4C1}', 'upload-post': '\u{1F4E4}',
          'word-docx': '\u{1F4D1}', 'nano-pdf': '\u{1F4C3}', 'market-research': '\u{1F4C8}',
        }
        for (const sk of data.skills) {
          const icon = skillIcons[sk.name] || '\u{1F9E9}'
          const div = document.createElement('div')
          div.className = 'skill-item'
          div.innerHTML = `
            <div class="skill-item-icon">${icon}</div>
            <div class="skill-item-info">
              <div class="skill-item-name">${escapeHtml(sk.name)}</div>
              <div class="skill-item-desc">${escapeHtml(sk.description)}</div>
            </div>`
          div.style.cursor = 'pointer'
          div.addEventListener('click', () => openSkillDetail(sk.name, icon))
          listEl.appendChild(div)
        }
      }
    }
  } catch {}

  // Delete button - hide for Nova
  document.getElementById('deleteAgentBtn').style.display = 'none'

  document.getElementById('detailAvatarGallery').hidden = true
  switchAgentTab('overview')
  openModal(agentDetailOverlay)
}


function getAvatarGradient(name) {
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return 'gradient-' + ((hash % 3) + 1)
}

function renderAgents() {
  agentsGrid.querySelectorAll('.agent-card:not(.add-card)').forEach((el) => el.remove())

  // Nova card (always first)
  if (window._nova) {
    const m = window._nova
    const mCard = document.createElement('div')
    mCard.className = 'agent-card nova-card'
    mCard.innerHTML = `
      <div class="agent-card-top">
        <div class="agent-avatar gradient-1"><img src="/api/nova/avatar?v=${novaAvatarVersion ?? 0}&thumb=128" alt="Nova"></div>
        <div class="agent-card-info">
          <div class="agent-name">Nova <span class="nova-badge">fo asszisztens</span> ${m.mood ? `<span class="mood-badge" title="${MOOD_LABEL_HU[m.mood.mood] || m.mood.mood} / ${m.mood.mood} (${m.mood.energy}% energia)">${MOOD_EMOJI_MAP[m.mood.mood] || ''}</span>` : ''}</div>
          <div class="agent-desc">${escapeHtml(m.description || '')}</div>
          ${m.mood ? `<div class="mood-energy"><div class="mood-energy-fill" style="width:${m.mood.energy}%"></div></div>` : ''}
        </div>
      </div>
      <div class="agent-card-footer">
        <span class="agent-model-badge opus">opus</span>
        <span class="process-indicator"><span class="process-dot running"></span>Fut</span>
        <span class="tg-status"><span class="tg-dot connected"></span>Online</span>
      </div>
    `
    mCard.addEventListener('click', () => openNovaDetail())
    agentsGrid.insertBefore(mCard, addBtn)
  }

  for (const agent of agents) {
    const card = document.createElement('div')
    card.className = 'agent-card'
    card.dataset.name = agent.name
    const initial = agent.name.charAt(0).toUpperCase()
    const gradientClass = getAvatarGradient(agent.name)
    const avatarHtml = (agent.hasImage || agent.hasAvatar)
      ? `<img src="/api/agents/${encodeURIComponent(agent.name)}/avatar?v=${agent.avatarVersion ?? 0}&thumb=128" alt="${escapeHtml(agent.name)}">`
      : initial

    const modelClass = agent.model && agent.model !== 'inherit' ? agent.model : ''
    const modelLabel = agent.model || 'inherit'
    const tgConnected = agent.hasTelegram || false
    const tgDotClass = tgConnected ? 'connected' : 'disconnected'
    const tgLabel = tgConnected ? 'Online' : 'Offline'
    const isRunning = agent.running || false
    const runDotClass = isRunning ? 'running' : 'stopped'
    const runLabel = isRunning ? t('Fut') : t('Leállva')

    card.innerHTML = `
      <div class="agent-card-top">
        <div class="agent-avatar ${gradientClass}">${avatarHtml}</div>
        <div class="agent-card-info">
          <div class="agent-name">${escapeHtml(capitalize(agent.name))} ${agent.mood ? `<span class="mood-badge" title="${MOOD_LABEL_HU[agent.mood.mood] || agent.mood.mood} / ${agent.mood.mood} (${agent.mood.energy}% energia)">${MOOD_EMOJI_MAP[agent.mood.mood] || ''}</span>` : ''}</div>
          <div class="agent-desc">${escapeHtml(agent.description || '')}</div>
          ${agent.mood ? `<div class="mood-energy"><div class="mood-energy-fill" style="width:${agent.mood.energy}%"></div></div>` : ''}
        </div>
      </div>
      <div class="agent-card-footer">
        <span class="agent-model-badge ${escapeHtml(modelClass)}">${escapeHtml(modelLabel)}</span>
        <span class="process-indicator"><span class="process-dot ${runDotClass}"></span>${runLabel}</span>
        <span class="tg-status"><span class="tg-dot ${tgDotClass}"></span>${tgLabel}</span>
      </div>
    `
    card.addEventListener('click', () => openAgentDetail(agent.name))
    agentsGrid.insertBefore(card, addBtn)
  }
}

// === Agent Detail ===
async function openAgentDetail(agentName) {
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}`)
    if (!res.ok) throw new Error('Nem található')
    currentAgent = await res.json()
  } catch (err) {
    showToast(t('Ágens betöltése sikertelen'), 3000, 'error')
    return
  }

  // Title
  document.getElementById('agentDetailTitle').textContent = capitalize(currentAgent.name)

  // Overview tab
  const initial = currentAgent.name.charAt(0).toUpperCase()
  const gradientClass = getAvatarGradient(currentAgent.name)
  const avatar = document.getElementById('agentDetailAvatar')
  avatar.className = 'detail-avatar ' + gradientClass
  avatar.innerHTML = (currentAgent.hasImage || currentAgent.hasAvatar)
    ? `<img src="/api/agents/${encodeURIComponent(currentAgent.name)}/avatar" alt="${escapeHtml(currentAgent.name)}">`
    : initial
  document.getElementById('agentDetailName').textContent = capitalize(currentAgent.name)
  document.getElementById('agentDetailDesc').textContent = currentAgent.description || ''
  document.getElementById('agentDetailModel').textContent = currentAgent.model || 'inherit'

  const tgConnected = currentAgent.hasTelegram || currentAgent.telegramConnected || false
  document.getElementById('agentDetailTgStatus').innerHTML = `<span class="tg-status"><span class="tg-dot ${tgConnected ? 'connected' : 'disconnected'}"></span>${tgConnected ? t('Csatlakozva') : t('Nincs bekötve')}</span>`

  // Settings tab - load Ollama models then set value
  loadOllamaModels().then(() => {
    document.getElementById('editAgentModel').value = currentAgent.model || 'claude-opus-4-6'
  })
  document.getElementById('editClaudeMd').value = currentAgent.claudeMd || currentAgent.content || ''
  document.getElementById('editSoulMd').value = currentAgent.soulMd || ''
  document.getElementById('editMcpJson').value = currentAgent.mcpJson || ''

  // Telegram tab
  updateTelegramTab(currentAgent)

  // Skills tab
  await loadSkills(currentAgent.name)

  // Process control
  updateProcessControl(currentAgent)

  // Delete button (restore visibility for normal agents)
  document.getElementById('deleteAgentBtn').style.display = ''
  document.getElementById('deleteAgentBtn').onclick = async () => {
    if (!confirm(`Biztosan törlöd: ${currentAgent.name}?`)) return
    try {
      await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}`, { method: 'DELETE' })
      closeModal(agentDetailOverlay)
      showToast(t('Ágens törölve'), 3000, 'success')
      loadAgents()
    } catch (err) {
      showToast(t('Hiba a törlés során'), 3000, 'error')
    }
  }

  // Reset to first tab, hide avatar gallery
  document.getElementById('detailAvatarGallery').hidden = true
  switchAgentTab('overview')
  openModal(agentDetailOverlay)
}

// === Detail avatar gallery ===
function populateDetailAvatarGrid() {
  const grid = document.getElementById('detailAvatarGrid')
  grid.innerHTML = ''
  for (const avatar of AVATARS) {
    const item = document.createElement('div')
    item.className = 'avatar-grid-item'
    item.dataset.avatar = avatar
    item.innerHTML = `<img src="/avatars/${avatar}" alt="${avatar.replace(/^\d+_/, '').replace('.png', '')}">`
    item.addEventListener('click', async () => {
      if (!currentAgent) return
      grid.querySelectorAll('.avatar-grid-item').forEach(i => i.classList.remove('selected'))
      item.classList.add('selected')
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/avatar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ galleryAvatar: avatar }),
        })
        if (!res.ok) throw new Error()
        showToast(t('Avatar frissítve'), 3000, 'success')
        if (currentAgent) currentAgent.avatarVersion = Math.floor(Date.now() / 1000)
        // Update the detail avatar display
        document.getElementById('agentDetailAvatar').innerHTML = `<img src="/api/agents/${encodeURIComponent(currentAgent.name)}/avatar?v=${currentAgent.avatarVersion ?? 0}" alt="">`
        document.getElementById('detailAvatarGallery').hidden = true
        loadAgents()
      } catch {
        showToast(t('Hiba az avatar mentése során'), 3000, 'error')
      }
    })
    grid.appendChild(item)
  }
}

document.getElementById('avatarChangeBtn').addEventListener('click', () => {
  const gallery = document.getElementById('detailAvatarGallery')
  gallery.hidden = !gallery.hidden
  if (!gallery.hidden) {
    const isNova = currentAgent && currentAgent.role === 'main'
    const avatarEndpoint = isNova ? '/api/nova/avatar' : `/api/agents/${encodeURIComponent(currentAgent.name)}/avatar`

    const grid = document.getElementById('detailAvatarGrid')
    grid.innerHTML = ''
    for (const avatar of AVATARS) {
      const item = document.createElement('div')
      item.className = 'avatar-grid-item'
      item.innerHTML = `<img src="/avatars/${avatar}" alt="${avatar.replace(/^\d+_/, '').replace('.png', '')}">`
      item.addEventListener('click', async () => {
        try {
          const res = await fetch(avatarEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ galleryAvatar: avatar }),
          })
          if (!res.ok) throw new Error()
          showToast(t('Avatar frissítve'), 3000, 'success')
          const newVer = Math.floor(Date.now() / 1000)
          if (isNova) novaAvatarVersion = newVer
          else if (currentAgent) currentAgent.avatarVersion = newVer
          const imgUrl = isNova ? `/api/nova/avatar?v=${novaAvatarVersion ?? 0}` : `/api/agents/${encodeURIComponent(currentAgent.name)}/avatar?v=${currentAgent.avatarVersion ?? 0}`
          document.getElementById('agentDetailAvatar').innerHTML = `<img src="${imgUrl}" alt="">`
          gallery.hidden = true
          loadAgents()
        } catch {
          showToast(t('Hiba az avatar mentése során'), 3000, 'error')
        }
      })
      grid.appendChild(item)
    }
  }
})

// Detail modal: AI avatar regenerálás (meglévő Nova/Zara/bármi agenthez)
document.addEventListener('DOMContentLoaded', () => {
  const regenBtn = document.getElementById('detailAvatarRegenBtn')
  if (!regenBtn) return
  regenBtn.addEventListener('click', async () => {
    if (!currentAgent) return
    const isNova = currentAgent.role === 'main'
    // Nova-ra kulcs-alapú nem működik a /api/agents/nova/avatar/generate, mert a
    // nova nem az agents/ alatt van. Main agent-re a jelenlegi endpoint
    // nem alkalmazható — erre figyelmeztet.
    if (isNova) {
      alert('Nova avatar generálás külön endpoint-on (még nincs). Kérlek használd a "Feltöltés"-t vagy várj a külön commit-ra.')
      return
    }
    const styleSel = document.getElementById('detailAvatarStyle')
    const style = styleSel ? styleSel.value : 'photorealistic'
    if (!confirm('Új AI-avatar generálása felülírja a jelenlegit. Folytatod?')) return
    regenBtn.disabled = true
    regenBtn.querySelector('.btn-text').hidden = true
    regenBtn.querySelector('.btn-loading').hidden = false
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/avatar/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast('Avatar hiba: ' + (data.error || '?'), 3000, 'error')
        return
      }
      showToast('Avatar legenerálva ✓', 2500, 'success')
      const newVer = Math.floor(Date.now() / 1000)
      currentAgent.avatarVersion = newVer
      const imgUrl = `/api/agents/${encodeURIComponent(currentAgent.name)}/avatar?v=${newVer}`
      document.getElementById('agentDetailAvatar').innerHTML = `<img src="${imgUrl}" alt="">`
      document.getElementById('detailAvatarGallery').hidden = true
      loadAgents()
    } catch (err) {
      showToast('Hálózati hiba: ' + (err.message || err), 3000, 'error')
    } finally {
      regenBtn.disabled = false
      regenBtn.querySelector('.btn-text').hidden = false
      regenBtn.querySelector('.btn-loading').hidden = true
    }
  })
})

// Avatar file upload
document.getElementById('avatarFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) { showToast('Max 5MB!'); return }
  const isNova = currentAgent && currentAgent.role === 'main'
  const avatarEndpoint = isNova ? '/api/nova/avatar' : `/api/agents/${encodeURIComponent(currentAgent.name)}/avatar`
  const formData = new FormData()
  formData.append('file', file)
  try {
    const res = await fetch(avatarEndpoint, { method: 'POST', body: formData })
    if (!res.ok) throw new Error()
    showToast('Avatar feltoltve')
    const newVer = Math.floor(Date.now() / 1000)
    if (isNova) novaAvatarVersion = newVer
    else if (currentAgent) currentAgent.avatarVersion = newVer
    const imgUrl = isNova ? `/api/nova/avatar?v=${novaAvatarVersion ?? 0}` : `/api/agents/${encodeURIComponent(currentAgent.name)}/avatar?v=${currentAgent.avatarVersion ?? 0}`
    document.getElementById('agentDetailAvatar').innerHTML = `<img src="${imgUrl}" alt="">`
    document.getElementById('detailAvatarGallery').hidden = true
    loadAgents()
  } catch {
    showToast('Hiba az avatar feltoltese soran', 3000, 'error')
  }
  e.target.value = ''
})

// === Process control ===
function updateProcessControl(agent) {
  const running = agent.running || false
  const isNova = agent.role === 'main'
  const dot = document.getElementById('processDot')
  const label = document.getElementById('processLabel')
  const uptime = document.getElementById('processUptime')
  const startBtn = document.getElementById('agentStartBtn')
  const stopBtn = document.getElementById('agentStopBtn')

  dot.className = 'process-dot ' + (running ? 'running' : 'stopped')
  label.textContent = running ? t('Fut') : t('Leállva')

  if (isNova) {
    // Nova: systemctl kezeli, nem kézzel indítható
    startBtn.hidden = true
    stopBtn.hidden = true
  } else {
    startBtn.hidden = running
    stopBtn.hidden = !running
  }

  if (running && agent.session) {
    uptime.textContent = `tmux: ${agent.session}`
  } else {
    uptime.textContent = isNova ? 'systemctl: claudeclaw-channels' : ''
  }
}

document.getElementById('agentStartBtn').addEventListener('click', async () => {
  if (!currentAgent) return
  const btn = document.getElementById('agentStartBtn')
  btn.disabled = true
  btn.querySelector('.btn-text').hidden = true
  btn.querySelector('.btn-loading').hidden = false

  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/start`, { method: 'POST' })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Indítási hiba')
    }
    showToast(t('Ágens elindítva!'))
    // Refresh
    const detailRes = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}`)
    if (detailRes.ok) {
      currentAgent = await detailRes.json()
      updateProcessControl(currentAgent)
    }
    loadAgents()
  } catch (err) {
    showToast(`Hiba: ${err.message}`, 3000, 'error')
  } finally {
    btn.disabled = false
    btn.querySelector('.btn-text').hidden = false
    btn.querySelector('.btn-loading').hidden = true
  }
})

document.getElementById('agentStopBtn').addEventListener('click', async () => {
  if (!currentAgent) return
  if (!confirm(t('Biztosan leállítod az ágenst?'))) return

  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/stop`, { method: 'POST' })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Leállítási hiba')
    }
    showToast(t('Ágens leállítva'))
    const detailRes = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}`)
    if (detailRes.ok) {
      currentAgent = await detailRes.json()
      updateProcessControl(currentAgent)
    }
    loadAgents()
  } catch (err) {
    showToast(`Hiba: ${err.message}`, 3000, 'error')
  }
})

// === Tab switching ===
document.getElementById('agentTabNav').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn')
  if (!btn) return
  switchAgentTab(btn.dataset.tab)
})

function switchAgentTab(tab) {
  document.querySelectorAll('#agentTabNav .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab))
  document.getElementById('tabOverview').hidden = tab !== 'overview'
  document.getElementById('tabSettings').hidden = tab !== 'settings'
  document.getElementById('tabTelegram').hidden = tab !== 'telegram'
  document.getElementById('tabSkills').hidden = tab !== 'skills'
}

// === Settings save buttons ===
async function loadOllamaModels() {
  const group = document.getElementById('ollamaModelGroup')
  if (!group) return
  group.innerHTML = ''
  try {
    const res = await fetch('/api/ollama/models')
    const models = await res.json()
    for (const m of models) {
      const opt = document.createElement('option')
      opt.value = m.name
      opt.textContent = `${m.name} (${m.size})`
      group.appendChild(opt)
    }
  } catch { /* Ollama not available */ }
}

document.getElementById('saveModelBtn').addEventListener('click', async () => {
  if (!currentAgent || currentAgent.role === 'main') return
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: document.getElementById('editAgentModel').value }),
    })
    if (!res.ok) throw new Error()
    showToast(t('Modell mentve (újraindítás szükséges)'))
    loadAgents()
  } catch { showToast(t('Hiba a mentés során'), 3000, 'error') }
})

document.getElementById('saveClaudeMdBtn').addEventListener('click', async () => {
  if (!currentAgent) return
  const endpoint = currentAgent.role === 'main' ? '/api/nova' : `/api/agents/${encodeURIComponent(currentAgent.name)}`
  try {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claudeMd: document.getElementById('editClaudeMd').value }),
    })
    if (!res.ok) throw new Error()
    showToast('CLAUDE.md mentve', 3000, 'success')
  } catch { showToast(t('Hiba a mentés során'), 3000, 'error') }
})

document.getElementById('saveSoulMdBtn').addEventListener('click', async () => {
  if (!currentAgent) return
  const endpoint = currentAgent.role === 'main' ? '/api/nova' : `/api/agents/${encodeURIComponent(currentAgent.name)}`
  try {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ soulMd: document.getElementById('editSoulMd').value }),
    })
    if (!res.ok) throw new Error()
    showToast('SOUL.md mentve', 3000, 'success')
  } catch { showToast(t('Hiba a mentés során'), 3000, 'error') }
})

document.getElementById('saveMcpJsonBtn').addEventListener('click', async () => {
  if (!currentAgent) return
  const endpoint = currentAgent.role === 'main' ? '/api/nova' : `/api/agents/${encodeURIComponent(currentAgent.name)}`
  try {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mcpJson: document.getElementById('editMcpJson').value }),
    })
    if (!res.ok) throw new Error()
    showToast('.mcp.json mentve', 3000, 'success')
  } catch { showToast(t('Hiba a mentés során'), 3000, 'error') }
})

// === Telegram tab ===
function updateTelegramTab(agent) {
  const connected = agent.hasTelegram || false
  const running = agent.running || false
  document.getElementById('tgNotConnected').hidden = connected
  document.getElementById('tgConnected').hidden = !connected
  if (connected) {
    document.getElementById('tgBotUsername').textContent = agent.telegramBotUsername || '@bot'
    document.getElementById('tgRunNotice').hidden = running
    document.getElementById('tgRunningNotice').hidden = !running
  }
  document.getElementById('tgTokenInput').value = ''
  if (connected) refreshPendingPairings()
}

document.getElementById('tgConnectBtn').addEventListener('click', async () => {
  if (!currentAgent) return
  const token = document.getElementById('tgTokenInput').value.trim()
  if (!token) {
    document.getElementById('tgTokenInput').focus()
    return
  }

  const btn = document.getElementById('tgConnectBtn')
  btn.disabled = true
  btn.querySelector('.btn-text').hidden = true
  btn.querySelector('.btn-loading').hidden = false

  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: token }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Kapcsolódási hiba')
    }
    const result = await res.json()
    showToast(t('Telegram bot sikeresen csatlakoztatva!'), 3000, 'success')
    // Refresh detail
    await openAgentDetail(currentAgent.name)
    loadAgents()
  } catch (err) {
    showToast(`Hiba: ${err.message}`, 3000, 'error')
  } finally {
    btn.disabled = false
    btn.querySelector('.btn-text').hidden = false
    btn.querySelector('.btn-loading').hidden = true
  }
})

document.getElementById('tgTestBtn').addEventListener('click', async () => {
  if (!currentAgent) return
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/telegram/test`, { method: 'POST' })
    if (!res.ok) throw new Error()
    showToast('Kapcsolat rendben!')
  } catch {
    showToast(t('Kapcsolat tesztelése sikertelen'), 3000, 'error')
  }
})

// Pairing: refresh pending list
async function refreshPendingPairings() {
  if (!currentAgent) return
  const listEl = document.getElementById('tgPendingList')
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/telegram/pending`)
    if (!res.ok) return
    const pending = await res.json()
    listEl.innerHTML = ''
    if (pending.length === 0) {
      listEl.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:6px 0;">${t('Nincs várakozó párosítás')}</div>`
      return
    }
    for (const p of pending) {
      const item = document.createElement('div')
      item.className = 'tg-pending-item'
      const created = new Date(p.createdAt).toLocaleString('hu-HU')
      item.innerHTML = `
        <div>
          <span class="tg-pending-code">${escapeHtml(p.code)}</span>
          <span class="tg-pending-sender">Sender: ${escapeHtml(p.senderId)}</span>
        </div>
        <button class="btn-primary btn-compact" style="padding:5px 12px; font-size:12px; margin:0" data-code="${escapeHtml(p.code)}">Jóváhagyás</button>
      `
      item.querySelector('button').addEventListener('click', async () => {
        await approvePairing(p.code)
      })
      listEl.appendChild(item)
    }
  } catch { /* ignore */ }
}

async function approvePairing(code) {
  if (!currentAgent) return
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/telegram/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Jóváhagyási hiba')
    }
    showToast(t('Párosítás jóváhagyva!'))
    refreshPendingPairings()
  } catch (err) {
    showToast(`Hiba: ${err.message}`, 3000, 'error')
  }
}

document.getElementById('tgRefreshPendingBtn').addEventListener('click', refreshPendingPairings)

document.getElementById('tgApproveBtn').addEventListener('click', async () => {
  const code = document.getElementById('tgPairCode').value.trim()
  if (!code) { document.getElementById('tgPairCode').focus(); return }
  await approvePairing(code)
  document.getElementById('tgPairCode').value = ''
})

document.getElementById('tgDisconnectBtn').addEventListener('click', async () => {
  if (!currentAgent) return
  if (!confirm(t('Biztosan leválasztod a Telegram botot?'))) return
  try {
    await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/telegram`, { method: 'DELETE' })
    showToast(t('Telegram bot leválasztva'))
    await openAgentDetail(currentAgent.name)
    loadAgents()
  } catch {
    showToast(t('Hiba a leválasztás során'), 3000, 'error')
  }
})

// === Skills ===
// Skill emoji map for card icons
const SKILL_ICON_MAP = {
  'seo': '🔍', 'seo-content': '🔍', 'market-research': '📊',
  'social-media': '📱', 'social-media-engine': '📱',
  'copywriting': '✍️', 'wordpress': '🌐', 'upload-post': '📤',
  'hirlevelek': '📧', 'mailerlite': '📧', 'newsletter': '📧',
  'brave-search': '🔎', 'search': '🔎', 'blogwatcher': '👀',
  'crm': '💼', 'ai-smart-crm': '💼', 'aibooking': '📅',
  'billingo': '🧾', 'finance': '💰', 'ajanlat': '📋',
  'telegram': '💬', 'calendar': '📅', 'email': '📧',
  'memory': '🧠', 'prompt': '🤖', 'code': '💻',
}
function getSkillIcon(name) {
  const lower = name.toLowerCase()
  for (const [key, icon] of Object.entries(SKILL_ICON_MAP)) {
    if (lower.includes(key)) return icon
  }
  return '⚡'
}

async function loadSkills(agentName) {
  const listEl = document.getElementById('skillList')
  const emptyEl = document.getElementById('skillEmpty')
  listEl.innerHTML = ''

  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/skills`)
    if (!res.ok) throw new Error()
    const skills = await res.json()

    emptyEl.hidden = skills.length > 0
    document.getElementById('agentDetailSkillCount').textContent = skills.length

    for (const skill of skills) {
      const icon = getSkillIcon(skill.name)
      const item = document.createElement('div')
      item.className = 'skill-item'
      item.style.cursor = 'pointer'
      item.innerHTML = `
        <div class="skill-item-icon">${icon}</div>
        <div class="skill-item-info">
          <div class="skill-item-name">${escapeHtml(skill.name)}</div>
          ${skill.description ? `<div class="skill-item-desc">${escapeHtml(skill.description)}</div>` : ''}
        </div>
        <div class="skill-item-actions">
          <button class="btn-icon btn-icon-danger" title="${t('Törlés')}">${trashIcon()}</button>
        </div>
      `
      // Click card to view skill detail
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-icon-danger')) return
        openSkillDetail(skill.name, icon)
      })
      item.querySelector('.btn-icon-danger').addEventListener('click', async (e) => {
        e.stopPropagation()
        if (!confirm(`Skill törlése: ${skill.name}?`)) return
        try {
          await fetch(`/api/agents/${encodeURIComponent(agentName)}/skills/${encodeURIComponent(skill.name)}`, { method: 'DELETE' })
          showToast(t('Skill törölve'), 3000, 'success')
          loadSkills(agentName)
        } catch {
          showToast(t('Hiba a törlés során'), 3000, 'error')
        }
      })
      listEl.appendChild(item)
    }
  } catch {
    emptyEl.hidden = false
    document.getElementById('agentDetailSkillCount').textContent = '0'
  }
}

// Copy skill from Nova button
document.getElementById('copySkillBtn').addEventListener('click', async () => {
  if (!currentAgent) return
  try {
    // Fetch Nova skills
    const novaRes = await fetch('/api/nova')
    if (!novaRes.ok) { showToast(t('Hiba a Nova skillek lekérése során'), 3000, 'error'); return }
    const novaData = await novaRes.json()
    const novaSkills = novaData.skills || []
    if (novaSkills.length === 0) { showToast('Nova-nak nincsenek skillei'); return }

    // Fetch agent's existing skills
    const agentRes = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/skills`)
    const agentSkills = agentRes.ok ? await agentRes.json() : []
    const existingNames = new Set(agentSkills.map(s => s.name))

    // Filter out already existing
    const available = novaSkills.filter(s => !existingNames.has(s.name))
    if (available.length === 0) { showToast(t('Minden Nova skill már hozzá van adva')); return }

    // Build modal
    let overlay = document.getElementById('copySkillOverlay')
    if (overlay) overlay.remove()
    overlay = document.createElement('div')
    overlay.id = 'copySkillOverlay'
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal" style="max-width:500px">
        <div class="modal-header">
          <h2>Meglévő skill hozzáadása</h2>
          <button class="modal-close" id="copySkillClose">&times;</button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom:12px;color:var(--text-secondary)">Nova skillei (${available.length} elérhető)</p>
          <div class="skill-copy-list">
            ${available.map(s => `
              <div class="skill-copy-item">
                <input type="checkbox" id="copysk_${escapeHtml(s.name)}" value="${escapeHtml(s.name)}">
                <label for="copysk_${escapeHtml(s.name)}">
                  <strong>${escapeHtml(s.name)}</strong>
                  <div style="font-size:0.85em;color:var(--text-secondary)">${escapeHtml(s.description || '')}</div>
                </label>
              </div>
            `).join('')}
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
            <button class="btn-secondary" id="copySkillSelectAll">Összes kijelölése</button>
            <button class="btn-primary" id="copySkillSubmit">
              <span class="btn-text">Hozzáadás</span>
              <span class="btn-loading" hidden>⏳</span>
            </button>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    openModal(overlay)

    overlay.addEventListener('click', (e) => { if (e.target === overlay) { closeModal(overlay); overlay.remove() } })
    document.getElementById('copySkillClose').addEventListener('click', () => { closeModal(overlay); overlay.remove() })
    document.getElementById('copySkillSelectAll').addEventListener('click', () => {
      const boxes = overlay.querySelectorAll('input[type="checkbox"]')
      const allChecked = [...boxes].every(b => b.checked)
      boxes.forEach(b => b.checked = !allChecked)
    })
    document.getElementById('copySkillSubmit').addEventListener('click', async () => {
      const selected = [...overlay.querySelectorAll('input[type="checkbox"]:checked')].map(cb => cb.value)
      if (selected.length === 0) { showToast(t('Jelölj ki legalább egy skillt')); return }
      const btn = document.getElementById('copySkillSubmit')
      btn.disabled = true
      btn.querySelector('.btn-text').hidden = true
      btn.querySelector('.btn-loading').hidden = false
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/skills/copy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skills: selected }),
        })
        const result = await res.json()
        if (result.copied?.length) showToast(`${result.copied.length} skill hozzáadva: ${result.copied.join(', ')}`)
        if (result.errors?.length) showToast(`Hibák: ${result.errors.join(', ')}`)
        closeModal(overlay)
        overlay.remove()
        loadSkills(currentAgent.name)
      } catch (err) {
        showToast(t('Hiba a skillek másolása során'), 3000, 'error')
      } finally {
        btn.disabled = false
        btn.querySelector('.btn-text').hidden = false
        btn.querySelector('.btn-loading').hidden = true
      }
    })
  } catch (err) {
    showToast('Hiba: ' + (err.message || err), 3000, 'error')
  }
})

// Add skill button
document.getElementById('addSkillBtn').addEventListener('click', () => {
  document.getElementById('skillName').value = ''
  document.getElementById('skillDescription').value = ''
  skillFile = null
  document.getElementById('skillFileName').textContent = ''
  // Reset to create tab
  document.querySelectorAll('.skill-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.skillTab === 'create'))
  document.getElementById('skillTabCreate').hidden = false
  document.getElementById('skillTabImport').hidden = true
  openModal(skillModalOverlay)
  setTimeout(() => document.getElementById('skillName').focus(), 200)
})

// Skill modal tab switching
document.querySelectorAll('.skill-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.skill-tab-btn').forEach(b => b.classList.toggle('active', b === btn))
    document.getElementById('skillTabCreate').hidden = btn.dataset.skillTab !== 'create'
    document.getElementById('skillTabImport').hidden = btn.dataset.skillTab !== 'import'
  })
})

// File upload area
const skillFileArea = document.getElementById('skillFileArea')
const skillFileInput = document.getElementById('skillFileInput')
let skillFile = null

skillFileArea.addEventListener('click', () => skillFileInput.click())
skillFileArea.addEventListener('dragover', (e) => { e.preventDefault(); skillFileArea.style.borderColor = 'var(--accent)' })
skillFileArea.addEventListener('dragleave', () => { skillFileArea.style.borderColor = '' })
skillFileArea.addEventListener('drop', (e) => {
  e.preventDefault()
  skillFileArea.style.borderColor = ''
  const file = e.dataTransfer.files[0]
  if (file) { skillFile = file; document.getElementById('skillFileName').textContent = file.name }
})
skillFileInput.addEventListener('change', () => {
  const file = skillFileInput.files[0]
  if (file) { skillFile = file; document.getElementById('skillFileName').textContent = file.name }
})

// Create skill
document.getElementById('saveSkillBtn').addEventListener('click', async () => {
  if (!currentAgent) return
  const name = document.getElementById('skillName').value.trim()
  if (!name) { document.getElementById('skillName').focus(); return }

  const btn = document.getElementById('saveSkillBtn')
  btn.disabled = true
  btn.querySelector('.btn-text').hidden = true
  btn.querySelector('.btn-loading').hidden = false

  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: document.getElementById('skillDescription').value.trim(),
      }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Hiba')
    }
    closeModal(skillModalOverlay)
    showToast(t('Skill hozzáadva'), 3000, 'success')
    loadSkills(currentAgent.name)
  } catch (err) {
    showToast(`Hiba: ${err.message}`, 3000, 'error')
  } finally {
    btn.disabled = false
    btn.querySelector('.btn-text').hidden = false
    btn.querySelector('.btn-loading').hidden = true
  }
})

// Import skill
document.getElementById('importSkillBtn').addEventListener('click', async () => {
  if (!currentAgent || !skillFile) { showToast(t('Válassz egy .skill fájlt')); return }

  const btn = document.getElementById('importSkillBtn')
  btn.disabled = true
  btn.querySelector('.btn-text').hidden = true
  btn.querySelector('.btn-loading').hidden = false

  try {
    const formData = new FormData()
    formData.append('file', skillFile)
    const res = await fetch(`/api/agents/${encodeURIComponent(currentAgent.name)}/skills/import`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Import hiba')
    }
    const result = await res.json()
    closeModal(skillModalOverlay)
    showToast(`Skill importálva: ${result.imported.join(', ')}`)
    skillFile = null
    document.getElementById('skillFileName').textContent = ''
    loadSkills(currentAgent.name)
  } catch (err) {
    showToast(`Hiba: ${err.message}`, 3000, 'error')
  } finally {
    btn.disabled = false
    btn.querySelector('.btn-text').hidden = false
    btn.querySelector('.btn-loading').hidden = true
  }
})

// ============================================================
// === Schedules ===
// ============================================================

const scheduleList = document.getElementById('scheduleList')
const scheduleEmpty = document.getElementById('scheduleEmpty')
const scheduleModalOverlay = document.getElementById('scheduleModalOverlay')
const scheduleFrequency = document.getElementById('scheduleFrequency')
const scheduleTimeGroup = document.getElementById('scheduleTimeGroup')
const customScheduleGroup = document.getElementById('customScheduleGroup')
const saveScheduleBtn = document.getElementById('saveScheduleBtn')

let schedules = []
const MOOD_EMOJI_MAP = { happy: '😊', alert: '🌟', curious: '🧐', calm: '😌', tired: '😴', cautious: '😬', sad: '😔', focused: '🎯', neutral: '😐' }
const MOOD_LABEL_HU = { happy: 'boldog', alert: 'éber', curious: 'kíváncsi', calm: 'nyugodt', tired: 'fáradt', cautious: 'óvatos', sad: 'szomorú', focused: 'fókuszált', neutral: 'semleges' }
let scheduleAgents = []
let hideHeartbeats = (() => {
  try { return localStorage.getItem('cc-hide-heartbeats') === '1' } catch { return false }
})()
function applyHeartbeatFilter(tasks) {
  return hideHeartbeats ? tasks.filter(t => t.type !== 'heartbeat') : tasks
}
let currentScheduleView = 'list'

// Modal wiring
document.getElementById('addScheduleBtn').addEventListener('click', () => {
  resetScheduleForm()
  document.getElementById('scheduleModalTitle').textContent = t('Új ütemezett feladat')
  document.getElementById('scheduleName').disabled = false
  openModal(scheduleModalOverlay)
  loadScheduleAgents().then(() => {
    setTimeout(() => document.getElementById('scheduleName').focus(), 200)
  })
})
document.getElementById('scheduleModalClose').addEventListener('click', () => closeModal(scheduleModalOverlay))
scheduleModalOverlay.addEventListener('click', (e) => { if (e.target === scheduleModalOverlay) closeModal(scheduleModalOverlay) })

// Frequency change handler
// Type toggle (task vs heartbeat)
document.getElementById('scheduleType').addEventListener('change', () => {
  const isHeartbeat = document.getElementById('scheduleType').value === 'heartbeat'
  document.getElementById('heartbeatTemplateGroup').hidden = !isHeartbeat
  if (isHeartbeat && !document.getElementById('schedulePrompt').value.trim()) {
    // Set default heartbeat schedule to every 15 min
    scheduleFrequency.value = 'custom'
    document.getElementById('scheduleCustomCron').value = '*/15 * * * *'
    customScheduleGroup.hidden = false
    scheduleTimeGroup.hidden = true
  }
})

// Heartbeat templates
const HEARTBEAT_TEMPLATES = {
  calendar: {
    desc: 'Naptár figyelő',
    prompt: 'Ellenorizd a naptaramat (list-events a mai napra). Ha van meeting 1 oran belul, szolj Telegramon es 10 perccel a meeting elott is emlekeztetess. Ha nincs kozelgo esemeny, ne irj semmit.',
    schedule: '*/15 * * * *',
  },
  email: {
    desc: 'Email figyelő',
    prompt: 'Ellenorizd az emailjeimet (search_emails newer_than:1h). Ha surgos vagy fontos levelet talalsz (pl. ugyfeltol, fonokotol, fizetessel kapcsolatos), szolj Telegramon. Ha csak promo/newsletter, ne irj semmit.',
    schedule: '*/30 * * * *',
  },
  kanban: {
    desc: 'Kanban határidő figyelő',
    prompt: 'Ellenorizd a kanban tablat (curl -s http://localhost:3420/api/kanban). Ha van olyan kartya aminek ma jar le a hatrideje vagy urgent prioritasu es meg nincs done, szolj Telegramon. Ha minden rendben, ne irj semmit.',
    schedule: '0 */2 * * *',
  },
  full: {
    desc: 'Teljes ellenőrzés',
    prompt: 'Ellenorizd: 1) Naptar - van-e meeting 1 oran belul? 2) Email - jott-e surgos level az elmult oraban? 3) Kanban - van-e mai hataridovel kartya? Ha BARMIT talalsz ami fontos, szolj Telegramon tomoren. Ha minden csendes, ne irj semmit.',
    schedule: '*/15 * * * *',
  },
}

document.getElementById('heartbeatTemplate').addEventListener('change', () => {
  const tpl = HEARTBEAT_TEMPLATES[document.getElementById('heartbeatTemplate').value]
  if (!tpl) return
  document.getElementById('scheduleDesc').value = tpl.desc
  document.getElementById('schedulePrompt').value = tpl.prompt
  document.getElementById('scheduleCustomCron').value = tpl.schedule
  scheduleFrequency.value = 'custom'
  customScheduleGroup.hidden = false
  scheduleTimeGroup.hidden = true
})

scheduleFrequency.addEventListener('change', () => {
  const freq = scheduleFrequency.value
  const needsTime = ['daily', 'weekdays', 'weekly-mon', 'weekly-fri'].includes(freq)
  const isCustom = freq === 'custom'
  scheduleTimeGroup.hidden = !needsTime
  customScheduleGroup.hidden = !isCustom
  if (isCustom) document.getElementById('scheduleCustomCron').focus()
})

// View toggle buttons
document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn[data-view]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    currentScheduleView = btn.dataset.view
    document.getElementById('scheduleListView').hidden = currentScheduleView !== 'list'
    document.getElementById('scheduleTimelineView').hidden = currentScheduleView !== 'timeline'
    document.getElementById('scheduleWeekView').hidden = currentScheduleView !== 'week'
    const filteredSchedules = applyHeartbeatFilter(schedules)
    if (currentScheduleView === 'timeline') renderTimeline(filteredSchedules)
    if (currentScheduleView === 'week') renderWeekView(filteredSchedules)
    if (currentScheduleView === 'list') renderScheduleList(filteredSchedules)
  })
})

function resetScheduleForm() {
  document.getElementById('scheduleName').value = ''
  document.getElementById('scheduleDesc').value = ''
  document.getElementById('schedulePrompt').value = ''
  scheduleFrequency.value = 'daily'
  document.getElementById('scheduleTime').value = '09:00'
  document.getElementById('scheduleCustomCron').value = ''
  customScheduleGroup.hidden = true
  scheduleTimeGroup.hidden = false
  document.getElementById('expandQuestions').hidden = true
  document.getElementById('expandStatus').textContent = ''
  expandAnswers = []
  document.getElementById('scheduleEditName').value = ''
  document.getElementById('scheduleType').value = 'task'
  document.getElementById('heartbeatTemplateGroup').hidden = true
  document.getElementById('heartbeatTemplate').value = ''
  saveScheduleBtn.disabled = false
  saveScheduleBtn.querySelector('.btn-text').hidden = false
  saveScheduleBtn.querySelector('.btn-loading').hidden = true
}

function getScheduleCron() {
  const freq = scheduleFrequency.value
  if (freq === 'custom') return document.getElementById('scheduleCustomCron').value.trim()

  const time = document.getElementById('scheduleTime').value || '09:00'
  const [h, m] = time.split(':').map(Number)

  switch (freq) {
    case 'daily': return `${m} ${h} * * *`
    case 'weekdays': return `${m} ${h} * * 1-5`
    case 'weekly-mon': return `${m} ${h} * * 1`
    case 'weekly-fri': return `${m} ${h} * * 5`
    case 'hourly': return `0 * * * *`
    case 'every2h': return `0 */2 * * *`
    case 'every4h': return `0 */4 * * *`
    case 'every30m': return `*/30 * * * *`
    default: return `${m} ${h} * * *`
  }
}

function parseCronToForm(cron) {
  const parts = cron.split(' ')
  if (parts.length < 5) { scheduleFrequency.value = 'custom'; customScheduleGroup.hidden = false; document.getElementById('scheduleCustomCron').value = cron; return }
  const [minute, hour, dom, month, dow] = parts

  // Interval patterns
  if (minute === '*/30' && hour === '*') { scheduleFrequency.value = 'every30m'; scheduleTimeGroup.hidden = true; customScheduleGroup.hidden = true; return }
  if (minute === '0' && hour === '*') { scheduleFrequency.value = 'hourly'; scheduleTimeGroup.hidden = true; customScheduleGroup.hidden = true; return }
  if (minute === '0' && hour === '*/2') { scheduleFrequency.value = 'every2h'; scheduleTimeGroup.hidden = true; customScheduleGroup.hidden = true; return }
  if (minute === '0' && hour === '*/4') { scheduleFrequency.value = 'every4h'; scheduleTimeGroup.hidden = true; customScheduleGroup.hidden = true; return }

  // Time-based patterns
  const h = parseInt(hour); const m = parseInt(minute)
  if (!isNaN(h) && !isNaN(m)) {
    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    document.getElementById('scheduleTime').value = timeStr
    scheduleTimeGroup.hidden = false
    customScheduleGroup.hidden = true

    if (dow === '1-5') { scheduleFrequency.value = 'weekdays'; return }
    if (dow === '1') { scheduleFrequency.value = 'weekly-mon'; return }
    if (dow === '5') { scheduleFrequency.value = 'weekly-fri'; return }
    if (dow === '*' && dom === '*') { scheduleFrequency.value = 'daily'; return }
  }

  // Fallback to custom
  scheduleFrequency.value = 'custom'
  customScheduleGroup.hidden = false
  scheduleTimeGroup.hidden = true
  document.getElementById('scheduleCustomCron').value = cron
}

function describeCron(cron) {
  const parts = cron.split(' ')
  if (parts.length < 5) return cron
  const [minute, hour, dom, month, dow] = parts

  // Interval patterns
  if (minute.startsWith('*/')) return currentLang === 'en' ? `Every ${minute.split('/')[1]} minutes` : `${minute.split('/')[1]} percenként`
  if (hour.startsWith('*/')) return currentLang === 'en' ? `Every ${hour.split('/')[1]} hours` : `${hour.split('/')[1]} óránként`
  if (minute === '0' && hour === '*') return t('Minden órában')

  // Time-based
  const h = parseInt(hour); const m = parseInt(minute)
  if (!isNaN(h) && !isNaN(m)) {
    const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    const dowNames = currentLang === 'en'
      ? { '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday', '0': 'Sunday', '7': 'Sunday' }
      : { '1': 'Hétfőn', '2': 'Kedden', '3': 'Szerdán', '4': 'Csütörtökön', '5': 'Pénteken', '6': 'Szombaton', '0': 'Vasárnap', '7': 'Vasárnap' }
    if (dow === '1-5') return `${currentLang === 'en' ? 'Weekdays' : 'Hétköznap'} ${timeStr}`
    if (dow === '0,6' || dow === '6,0') return `${currentLang === 'en' ? 'Weekends' : 'Hétvégén'} ${timeStr}`
    if (dowNames[dow]) return `${dowNames[dow]} ${timeStr}`
    if (dow === '*' && dom === '*') return `${currentLang === 'en' ? 'Daily' : 'Naponta'} ${timeStr}`
    if (dom !== '*') return currentLang === 'en' ? `Monthly on day ${dom} at ${timeStr}` : `Minden hónap ${dom}. napján ${timeStr}`
  }

  return cron
}

function cronToHours(cron) {
  const parts = cron.split(' ')
  if (parts.length < 5) return []
  const hour = parts[1]

  if (hour === '*') return Array.from({length: 24}, (_, i) => i)
  if (hour.includes('/')) {
    const step = parseInt(hour.split('/')[1])
    if (isNaN(step) || step <= 0) return []
    return Array.from({length: 24}, (_, i) => i).filter(h => h % step === 0)
  }
  if (hour.includes(',')) return hour.split(',').map(Number).filter(n => !isNaN(n))
  if (hour.includes('-')) {
    const [start, end] = hour.split('-').map(Number)
    if (isNaN(start) || isNaN(end)) return []
    return Array.from({length: end - start + 1}, (_, i) => start + i)
  }
  const h = parseInt(hour)
  return isNaN(h) ? [] : [h]
}

function cronToMinute(cron) {
  const parts = cron.split(' ')
  if (parts.length < 1) return 0
  const m = parseInt(parts[0])
  return isNaN(m) ? 0 : m
}

async function loadScheduleAgents() {
  try {
    const res = await fetch('/api/schedules/agents')
    scheduleAgents = await res.json()
    const sel = document.getElementById('scheduleAgent')
    sel.innerHTML = ''
    for (const a of scheduleAgents) {
      const opt = document.createElement('option')
      opt.value = a.name
      opt.textContent = a.label || a.name
      sel.appendChild(opt)
    }
  } catch (err) {
    console.error('Ágens lista hiba:', err)
  }
}

async function loadSchedules() {
  try {
    const [schedulesRes] = await Promise.all([
      fetch('/api/schedules'),
      loadScheduleAgents(),
    ])
    schedules = await schedulesRes.json()
    const filteredSchedules = applyHeartbeatFilter(schedules)
    renderScheduleList(filteredSchedules)
    if (currentScheduleView === 'timeline') renderTimeline(filteredSchedules)
    if (currentScheduleView === 'week') renderWeekView(filteredSchedules)
    // Upstream #36 parity: pending queue állapot
    loadPendingQueue().catch(() => {})
  } catch (err) {
    console.error('Ütemezés betöltés hiba:', err)
  }
}

// Upstream #36 parity: a queue-ban várakozó taskokat listázza a fejlécben.
// Csak ha van pending item, különben a badge rejtett.
async function loadPendingQueue() {
  const badge = document.getElementById('pendingQueueBadge')
  if (!badge) return
  try {
    const res = await fetch('/api/schedules/pending')
    if (!res.ok) { badge.hidden = true; return }
    const queue = await res.json()
    if (!Array.isArray(queue) || queue.length === 0) {
      badge.hidden = true
      return
    }
    const stuck = queue.filter(q => q.alertSent)
    badge.classList.toggle('stuck', stuck.length > 0)
    const formatAge = (ms) => {
      const min = Math.round(ms / 60000)
      if (min < 60) return `${min}p`
      const h = Math.floor(min / 60)
      const m = min % 60
      return `${h}h ${m}p`
    }
    const header = stuck.length > 0
      ? `⏳ ${queue.length} feladat vár a queue-ban (${stuck.length} stuck >1h)`
      : `⏳ ${queue.length} feladat vár a queue-ban`
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
    const items = queue.map(q =>
      `<div class="pending-queue-badge-item">• <strong>${esc(q.taskName)}</strong> (${esc(q.agentName)}) — ${formatAge(q.ageMs)} / ${q.retries} retry${q.alertSent ? ' ⚠️' : ''}</div>`
    ).join('')
    badge.innerHTML = `<div class="pending-queue-badge-header">${header}</div>${items}`
    badge.hidden = false
  } catch (err) {
    console.error('Pending queue betöltés hiba:', err)
    badge.hidden = true
  }
}

function renderScheduleList(tasks) {
  scheduleList.innerHTML = ''
  scheduleEmpty.hidden = tasks.length > 0

  for (const task of tasks) {
    const row = document.createElement('div')
    row.className = 'schedule-row' + (task.type === 'heartbeat' ? ' schedule-row-heartbeat' : '')
    const agent = scheduleAgents.find(a => a.name === task.agent) || { name: task.agent || 'nova', avatar: '/api/nova/avatar', label: task.agent || 'nova' }

    row.innerHTML = `
      <div class="schedule-agent-avatar">
        <img src="${agent.avatar}?v=${agent.avatarVersion ?? 0}&thumb=64" alt="" onerror="this.style.display='none'">
      </div>
      <div class="schedule-info">
        <div class="schedule-title">
          ${escapeHtml(task.description || task.name)}
          ${task.type === 'heartbeat' ? '<span class="badge badge-heartbeat">💓 heartbeat</span>' : ''}
          <span class="badge ${task.enabled ? 'badge-active' : 'badge-paused'}">${task.enabled ? t('aktív') : t('szünet')}</span>
        </div>
        <div class="schedule-meta">
          <span class="schedule-cron">${escapeHtml(task.schedule)}</span>
          <span>${describeCron(task.schedule)}</span>
          <span class="schedule-agent-name">${escapeHtml(agent.label || agent.name)}</span>
        </div>
      </div>
      <div class="schedule-actions">
        <button class="btn-icon" data-action="toggle" title="${task.enabled ? t('Szüneteltetés') : t('Folytatás')}">
          ${task.enabled ? pauseIcon() : playIcon()}
        </button>
        <button class="btn-icon btn-icon-danger" data-action="delete" title="Törlés">
          ${trashIcon()}
        </button>
      </div>
    `

    // Row click -> edit (but not action buttons)
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-icon')) return
      openEditSchedule(task)
    })

    // Action buttons
    row.querySelector('[data-action="toggle"]').addEventListener('click', async (e) => {
      e.stopPropagation()
      try {
        await fetch(`/api/schedules/${encodeURIComponent(task.name)}/toggle`, { method: 'POST' })
        showToast(task.enabled ? t('Feladat szüneteltetve') : t('Feladat újraindult'))
        loadSchedules()
      } catch { showToast(t('Hiba történt'), 3000, 'error') }
    })

    row.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm(t('Biztosan törlöd ezt a feladatot?'))) return
      try {
        await fetch(`/api/schedules/${encodeURIComponent(task.name)}`, { method: 'DELETE' })
        showToast(t('Feladat törölve'), 3000, 'success')
        loadSchedules()
      } catch { showToast(t('Hiba a törlés során'), 3000, 'error') }
    })

    scheduleList.appendChild(row)
  }
}

function renderTimeline(tasks) {
  const hoursEl = document.getElementById('timelineHours')
  const bodyEl = document.getElementById('timelineBody')
  hoursEl.innerHTML = ''
  bodyEl.innerHTML = ''

  // Build hour labels
  for (let h = 0; h < 24; h++) {
    const hourDiv = document.createElement('div')
    hourDiv.className = 'timeline-hour'
    hourDiv.textContent = h.toString().padStart(2, '0')
    hoursEl.appendChild(hourDiv)
  }

  // Group tasks by agent
  const agentTasks = {}
  for (const task of tasks) {
    const agentName = task.agent || 'nova'
    if (!agentTasks[agentName]) agentTasks[agentName] = []
    agentTasks[agentName].push(task)
  }

  // If no tasks, show empty state
  if (Object.keys(agentTasks).length === 0) {
    bodyEl.innerHTML = `<div class="schedule-empty" style="padding:40px;text-align:center;color:var(--text-muted)">${t('Nincsenek ütemezett feladatok')}</div>`
    return
  }

  for (const [agentName, agTasks] of Object.entries(agentTasks)) {
    const agent = scheduleAgents.find(a => a.name === agentName) || { name: agentName, avatar: '/api/nova/avatar', label: agentName }

    const row = document.createElement('div')
    row.className = 'timeline-row'

    // Agent label
    row.innerHTML = `
      <div class="timeline-agent">
        <div class="timeline-agent-avatar">
          <img src="${agent.avatar}?v=${agent.avatarVersion ?? 0}&thumb=64" alt="" onerror="this.style.display='none'">
        </div>
        <span class="timeline-agent-name">${escapeHtml(agent.label || agent.name)}</span>
      </div>
      <div class="timeline-track"></div>
    `

    const track = row.querySelector('.timeline-track')

    // Place markers — track slot counts to offset overlapping same-time markers
    const slotCount = {}
    for (const task of agTasks) {
      const hours = cronToHours(task.schedule)
      const minute = cronToMinute(task.schedule)
      for (const h of hours) {
        const slotKey = `${h}:${minute}`
        slotCount[slotKey] = (slotCount[slotKey] || 0) + 1
      }
    }
    const slotIdx = {}
    for (const task of agTasks) {
      const hours = cronToHours(task.schedule)
      const minute = cronToMinute(task.schedule)

      for (const h of hours) {
        const pct = ((h * 60 + minute) / (24 * 60)) * 100
        const slotKey = `${h}:${minute}`
        const idx = slotIdx[slotKey] || 0
        slotIdx[slotKey] = idx + 1
        const offsetPx = idx * 20  // 20px nudge per overlapping icon
        const marker = document.createElement('div')
        marker.className = 'timeline-marker' + (task.enabled ? '' : ' disabled') + (task.type === 'heartbeat' ? ' heartbeat' : '')
        marker.style.left = `calc(${pct}% - 16px + ${offsetPx}px)`
        marker.innerHTML = `
          <img src="${agent.avatar}?v=${agent.avatarVersion ?? 0}&thumb=64" alt="" onerror="this.style.display='none'">
          <div class="timeline-marker-tooltip">${escapeHtml(task.description || task.name)}</div>
        `
        marker.addEventListener('click', () => openEditSchedule(task))
        track.appendChild(marker)
      }
    }

    // "Now" indicator
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const nowPct = (nowMinutes / (24 * 60)) * 100
    const nowLine = document.createElement('div')
    nowLine.className = 'timeline-now'
    nowLine.style.left = `${nowPct}%`
    track.appendChild(nowLine)

    bodyEl.appendChild(row)
  }
}

function cronMatchesDay(cron, dayOfWeek) {
  // dayOfWeek: 0=Sun, 1=Mon, ..., 6=Sat
  const parts = cron.split(' ')
  if (parts.length < 5) return false
  const dow = parts[4]
  if (dow === '*') return true
  if (dow.includes(',')) return dow.split(',').map(Number).includes(dayOfWeek)
  if (dow.includes('-')) {
    const [start, end] = dow.split('-').map(Number)
    return dayOfWeek >= start && dayOfWeek <= end
  }
  return parseInt(dow) === dayOfWeek || (dayOfWeek === 0 && dow === '7')
}

function renderWeekView(data) {
  const grid = document.getElementById('weekGrid')
  grid.innerHTML = ''

  const dayNames = currentLang === 'en' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V']
  const dayNamesFull = currentLang === 'en' ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] : ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap']
  const dayNums = [1, 2, 3, 4, 5, 6, 0]

  const today = new Date()
  const todayDow = today.getDay()

  function expandDay(targetCol) {
    grid.querySelectorAll('.week-day').forEach(d => d.classList.remove('week-day-expanded'))
    targetCol.classList.add('week-day-expanded')
  }

  for (let i = 0; i < 7; i++) {
    const dayDow = dayNums[i]
    const isToday = dayDow === todayDow
    const dayCol = document.createElement('div')
    dayCol.className = 'week-day' + (isToday ? ' week-day-today week-day-expanded' : '')

    const header = document.createElement('div')
    header.className = 'week-day-header'
    header.textContent = dayCol.classList.contains('week-day-expanded') ? dayNamesFull[i] : dayNames[i]
    header.dataset.short = dayNames[i]
    header.dataset.full = dayNamesFull[i]
    dayCol.appendChild(header)

    const tasksForDay = data.filter(t => t.enabled && cronMatchesDay(t.schedule, dayDow))

    // Collapsed count badge
    const countDiv = document.createElement('div')
    countDiv.className = 'week-day-count'
    countDiv.innerHTML = `<span class="week-day-count-num">${tasksForDay.length}</span>`
    dayCol.appendChild(countDiv)

    // Expanded task list (positioned by time)
    const tasksDiv = document.createElement('div')
    tasksDiv.className = 'week-day-tasks'

    if (tasksForDay.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'week-day-empty'
      empty.textContent = t('Nincs feladat')
      dayCol.appendChild(empty)
    }

    // Add hour grid lines (6:00 - 22:00)
    for (let hr = 6; hr <= 22; hr += 2) {
      const pct = (hr / 24) * 100
      const line = document.createElement('div')
      line.className = 'week-hour-line'
      line.style.top = `${pct}%`
      tasksDiv.appendChild(line)
      const label = document.createElement('div')
      label.className = 'week-hour-label'
      label.style.top = `${pct}%`
      label.textContent = `${String(hr).padStart(2,'0')}:00`
      tasksDiv.appendChild(label)
    }

    // Group tasks by same time slot for side-by-side layout
    const timeSlots = {}
    for (const task of tasksForDay) {
      const minute = cronToMinute(task.schedule)
      const hours = cronToHours(task.schedule)
      const firstHour = hours.length > 0 ? hours[0] : 0
      const key = `${firstHour}:${minute}`
      if (!timeSlots[key]) timeSlots[key] = []
      timeSlots[key].push({ ...task, _repeats: hours.length })
    }

    for (const [key, tasks] of Object.entries(timeSlots)) {
      const [h, m] = key.split(':').map(Number)
      const topPct = ((h * 60 + m) / (24 * 60)) * 100
      const timeLabel = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
      const count = tasks.length

      tasks.forEach((task, idx) => {
        const agent = scheduleAgents.find(a => a.name === task.agent) || { name: task.agent || 'nova', avatar: '/api/nova/avatar' }

        const card = document.createElement('div')
        card.className = 'week-task-card' + (task.type === 'heartbeat' ? ' heartbeat' : '')
        card.style.top = `${topPct}%`

        // Side by side: divide available width (after 32px label margin)
        const availableStart = 32 // px from left for hour labels
        const gap = 4
        if (count > 1) {
          card.style.left = `calc(${availableStart}px + ${idx} * ((100% - ${availableStart + 8}px) / ${count}) + ${idx * gap}px)`
          card.style.width = `calc((100% - ${availableStart + 8 + (count - 1) * gap}px) / ${count})`
        } else {
          card.style.left = `${availableStart}px`
          card.style.right = '8px'
        }

        const repeatBadge = task._repeats > 1 ? `<span class="week-task-repeat">×${task._repeats}/nap</span>` : ''
        card.innerHTML = `
          <div class="week-task-avatar"><img src="${agent.avatar}?v=${agent.avatarVersion ?? 0}&thumb=64" alt=""></div>
          <div class="week-task-info">
            <div class="week-task-time">${timeLabel} ${repeatBadge}</div>
            <div class="week-task-name">${escapeHtml(task.description || task.name)}</div>
          </div>
        `
        card.addEventListener('click', (e) => { e.stopPropagation(); openEditSchedule(task) })
        tasksDiv.appendChild(card)
      })
    }

    dayCol.appendChild(tasksDiv)

    // Click to expand
    dayCol.addEventListener('click', () => {
      if (!dayCol.classList.contains('week-day-expanded')) {
        expandDay(dayCol)
        // Update headers
        grid.querySelectorAll('.week-day-header').forEach(hdr => {
          hdr.textContent = hdr.closest('.week-day-expanded') ? hdr.dataset.full : hdr.dataset.short
        })
      }
    })

    grid.appendChild(dayCol)
  }
}

function openEditSchedule(task) {
  // Reset expand state
  document.getElementById('expandQuestions').hidden = true
  document.getElementById('expandStatus').textContent = ''
  expandAnswers = []

  loadScheduleAgents().then(() => {
    document.getElementById('scheduleModalTitle').textContent = currentLang === 'en' ? 'Edit Task' : 'Feladat szerkesztése'
    document.getElementById('scheduleName').value = task.name
    document.getElementById('scheduleName').disabled = true
    document.getElementById('scheduleDesc').value = task.description || ''
    document.getElementById('schedulePrompt').value = task.prompt || ''
    document.getElementById('scheduleEditName').value = task.name

    // Set agent
    const agentSel = document.getElementById('scheduleAgent')
    if (agentSel.querySelector(`option[value="${task.agent}"]`)) {
      agentSel.value = task.agent
    }

    // Parse cron back to frequency + time
    parseCronToForm(task.schedule)

    openModal(scheduleModalOverlay)
  })
}

// Save schedule (create or update)
// === Prompt expand ===
let expandAnswers = []

document.getElementById('expandPromptBtn').addEventListener('click', async () => {
  const prompt = document.getElementById('schedulePrompt').value.trim()
  if (!prompt) { document.getElementById('schedulePrompt').focus(); return }

  const statusEl = document.getElementById('expandStatus')
  const questionsEl = document.getElementById('expandQuestions')
  const btn = document.getElementById('expandPromptBtn')

  btn.disabled = true
  statusEl.textContent = t('Kérdések generálása...')
  expandAnswers = []

  try {
    const agent = document.getElementById('scheduleAgent').value
    const res = await fetch('/api/schedules/expand-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, agent }),
    })
    if (!res.ok) throw new Error()
    const questions = await res.json()

    questionsEl.innerHTML = ''
    questionsEl.hidden = false
    statusEl.textContent = ''

    for (const q of questions) {
      const qDiv = document.createElement('div')
      qDiv.className = 'expand-question'

      const qText = document.createElement('div')
      qText.className = 'expand-question-text'
      qText.textContent = q.question
      qDiv.appendChild(qText)

      const optionsDiv = document.createElement('div')
      optionsDiv.className = 'expand-options'
      for (const opt of q.options) {
        const optBtn = document.createElement('button')
        optBtn.type = 'button'
        optBtn.className = 'expand-option'
        optBtn.textContent = opt
        optBtn.addEventListener('click', () => {
          optionsDiv.querySelectorAll('.expand-option').forEach(o => o.classList.remove('selected'))
          optBtn.classList.add('selected')
          // Store answer
          const existing = expandAnswers.find(a => a.question === q.question)
          if (existing) existing.answer = opt
          else expandAnswers.push({ question: q.question, answer: opt })
        })
        optionsDiv.appendChild(optBtn)
      }
      qDiv.appendChild(optionsDiv)
      questionsEl.appendChild(qDiv)
    }

    // Apply button
    const applyRow = document.createElement('div')
    applyRow.className = 'expand-apply-row'
    const applyBtn = document.createElement('button')
    applyBtn.type = 'button'
    applyBtn.className = 'btn-primary btn-compact'
    applyBtn.innerHTML = '<span class="btn-text">Prompt kibővítése</span><span class="btn-loading" hidden><span class="spinner"></span></span>'
    applyBtn.addEventListener('click', async () => {
      if (expandAnswers.length === 0) { showToast(t('Válaszolj legalább egy kérdésre')); return }
      applyBtn.disabled = true
      applyBtn.querySelector('.btn-text').hidden = true
      applyBtn.querySelector('.btn-loading').hidden = false
      try {
        const res2 = await fetch('/api/schedules/expand-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, answers: expandAnswers }),
        })
        if (!res2.ok) throw new Error()
        const { prompt: expanded } = await res2.json()
        document.getElementById('schedulePrompt').value = expanded
        questionsEl.hidden = true
        showToast(t('Prompt kibővítve!'))
      } catch {
        showToast(t('Hiba a kibővítés során'), 3000, 'error')
      } finally {
        applyBtn.disabled = false
        applyBtn.querySelector('.btn-text').hidden = false
        applyBtn.querySelector('.btn-loading').hidden = true
      }
    })
    applyRow.appendChild(applyBtn)
    questionsEl.appendChild(applyRow)
  } catch {
    statusEl.textContent = t('Hiba a kérdések generálásakor')
  } finally {
    btn.disabled = false
  }
})

saveScheduleBtn.addEventListener('click', async () => {
  const editName = document.getElementById('scheduleEditName').value
  const name = document.getElementById('scheduleName').value.trim()
  const description = document.getElementById('scheduleDesc').value.trim()
  const prompt = document.getElementById('schedulePrompt').value.trim()
  const schedule = getScheduleCron()
  const agent = document.getElementById('scheduleAgent').value
  const type = document.getElementById('scheduleType').value

  if (!name) { document.getElementById('scheduleName').focus(); return }
  if (!prompt) { document.getElementById('schedulePrompt').focus(); return }
  if (!schedule) { showToast(t('Válassz ütemezést')); return }

  saveScheduleBtn.disabled = true
  saveScheduleBtn.querySelector('.btn-text').hidden = true
  saveScheduleBtn.querySelector('.btn-loading').hidden = false

  try {
    if (editName) {
      // Update
      const res = await fetch(`/api/schedules/${encodeURIComponent(editName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, prompt, schedule, agent, type }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Hiba')
      }
      showToast(t('Feladat frissítve'), 3000, 'success')
    } else {
      // Create
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, prompt, schedule, agent, type }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Ismeretlen hiba')
      }
      showToast(t('Feladat létrehozva!'), 3000, 'success')
    }
    closeModal(scheduleModalOverlay)
    loadSchedules()
  } catch (err) {
    showToast(`Hiba: ${err.message}`, 3000, 'error')
  } finally {
    saveScheduleBtn.disabled = false
    saveScheduleBtn.querySelector('.btn-text').hidden = false
    saveScheduleBtn.querySelector('.btn-loading').hidden = true
  }
})

// ============================================================
// === Memories (Tier System + Daily Log) ===
// ============================================================

const memList = document.getElementById('memList')
const memEmpty = document.getElementById('memEmpty')
const memStats = document.getElementById('memStats')
const memSearchInput = document.getElementById('memSearchInput')
const memModalOverlay = document.getElementById('memModalOverlay')

let memSearchTimer = null
let currentMemTier = 'hot'
let currentLogDate = new Date().toISOString().split('T')[0]
let logDates = []

const tierLabels = { hot: '\u{1F525} Hot', warm: '\u{1F321}\uFE0F Warm', cold: '\u2744\uFE0F Cold', shared: '\u{1F517} Shared' }
const tierColors = { hot: '#dc3c3c', warm: '#d97757', cold: '#6a9bcc', shared: '#9a8a30' }

// Populate agent dropdowns from API
async function loadMemAgents() {
  try {
    const res = await fetch('/api/schedules/agents')
    const agents = await res.json()
    const sel = document.getElementById('memAgentFilter')
    const memSel = document.getElementById('memAgent')
    sel.innerHTML = '<option value="">Minden agens</option>'
    memSel.innerHTML = ''
    for (const a of agents) {
      sel.innerHTML += `<option value="${a.name}">${a.label}</option>`
      memSel.innerHTML += `<option value="${a.name}">${a.label}</option>`
    }
  } catch {}
}

// Agent filter change
document.getElementById('memAgentFilter').addEventListener('change', () => {
  if (currentMemTier === 'graph') {
    loadMemoryGraph()
  } else if (currentMemTier === 'log') {
    loadDailyLog()
  } else {
    loadMemories()
  }
})

// Search with debounce
memSearchInput.addEventListener('input', () => {
  clearTimeout(memSearchTimer)
  memSearchTimer = setTimeout(loadMemories, 300)
})

// Enter to search immediately
memSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(memSearchTimer)
    loadMemories()
  }
})

// Tab switching
document.getElementById('memTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.mem-tab')
  if (!tab) return
  // ux #10: aria-selected a screen reader számára (role="tab"-val együtt)
  document.querySelectorAll('.mem-tab').forEach(t => {
    t.classList.remove('active')
    t.setAttribute('aria-selected', 'false')
  })
  tab.classList.add('active')
  tab.setAttribute('aria-selected', 'true')
  currentMemTier = tab.dataset.tier

  const isLog = currentMemTier === 'log'
  const isGraph = currentMemTier === 'graph'
  document.getElementById('memTierView').hidden = isLog || isGraph
  document.getElementById('memLogView').hidden = !isLog
  document.getElementById('memGraphView').hidden = !isGraph

  if (isGraph) {
    loadMemoryGraph()
  } else if (isLog) {
    loadDailyLog()
  } else {
    loadMemories()
  }
})

// Add memory button
document.getElementById('memAddBtn').addEventListener('click', () => {
  document.getElementById('memModalTitle').textContent = 'Uj emlek'
  document.getElementById('memContent').value = ''
  document.getElementById('memTier').value = (currentMemTier === 'log' || currentMemTier === 'graph') ? 'warm' : currentMemTier
  document.getElementById('memKeywords').value = ''
  document.getElementById('memEditId').value = ''
  openModal(memModalOverlay)
  setTimeout(() => document.getElementById('memContent').focus(), 200)
})

// Close memory modal
document.getElementById('memModalClose').addEventListener('click', () => closeModal(memModalOverlay))
memModalOverlay.addEventListener('click', (e) => { if (e.target === memModalOverlay) closeModal(memModalOverlay) })

// Save memory (create or edit)
document.getElementById('saveMemBtn').addEventListener('click', async () => {
  const content = document.getElementById('memContent').value.trim()
  if (!content) { document.getElementById('memContent').focus(); return }

  const editId = document.getElementById('memEditId').value
  const tier = document.getElementById('memTier').value
  const agentId = document.getElementById('memAgent').value
  const keywords = document.getElementById('memKeywords').value.trim()

  try {
    if (editId) {
      await fetch(`/api/memories/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, tier, agent_id: agentId, keywords }),
      })
      showToast(t('Emlék frissítve'), 3000, 'success')
    } else {
      await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, content, tier, keywords }),
      })
      showToast(t('Emlék létrehozva'), 3000, 'success')
    }
    closeModal(memModalOverlay)
    loadMemories()
    loadMemStats()
  } catch {
    showToast('Hiba a mentes soran', 3000, 'error')
  }
})

async function loadMemStats() {
  try {
    const res = await fetch('/api/memories/stats')
    const stats = await res.json()
    const embCount = stats.withEmbedding || 0
    const embPct = stats.total > 0 ? Math.round(embCount / stats.total * 100) : 0
    memStats.innerHTML = `
      <div class="stat-card"><div class="stat-value">${stats.total}</div><div class="stat-label">Osszes</div></div>
      ${Object.entries(stats.byTier || {}).map(([tier, count]) =>
        `<div class="stat-card"><div class="stat-value" style="color:${tierColors[tier] || 'var(--accent)'}">${count}</div><div class="stat-label">${tierLabels[tier] || tier}</div></div>`
      ).join('')}
      <div class="stat-card"><div class="stat-value">${embCount}</div><div class="stat-label">Vektorok (${embPct}%)</div></div>
      <button class="btn-secondary btn-compact" id="memBackfillBtn" style="margin-left:auto;font-size:11px;padding:6px 12px;align-self:center">Vektorok generalasa</button>
    `
    document.getElementById('memBackfillBtn')?.addEventListener('click', async () => {
      const btn = document.getElementById('memBackfillBtn')
      if (btn) { btn.textContent = t('Generálás...'); btn.disabled = true }
      try {
        const r = await fetch('/api/memories/backfill', { method: 'POST' })
        const data = await r.json()
        showToast(`${data.count} emlekhez vektor generalva`)
        loadMemStats()
      } catch { showToast(t('Hiba a vektor generálás során'), 3000, 'error') }
    })
  } catch (err) {
    console.error('Stats hiba:', err)
  }
}

async function loadMemories() {
  if (currentMemTier === 'log' || currentMemTier === 'graph') return
  const q = memSearchInput.value.trim()
  const agent = document.getElementById('memAgentFilter').value
  const searchMode = document.getElementById('memSearchMode')?.value || 'hybrid'
  const params = new URLSearchParams()
  if (q) {
    params.set('q', q)
    params.set('mode', searchMode)
  }
  if (agent) params.set('agent', agent)
  if (currentMemTier) params.set('tier', currentMemTier)
  // 200 a backend max cap — tier-enként (pl. warm=161) ez elég, lapozás nélkül
  params.set('limit', '200')

  const t0 = performance.now()
  try {
    const res = await fetch(`/api/memories?${params}`)
    let memories = await res.json()
    // Client-side date range filter
    const range = document.getElementById('memDateRange')?.value || 'all'
    if (range !== 'all') {
      const days = parseInt(range)
      const cutoff = Math.floor(Date.now() / 1000) - days * 86400
      memories = memories.filter(m => (m.created_at || 0) >= cutoff)
    }
    // Client-side sort
    const sort = document.getElementById('memSortBy')?.value || 'accessed_desc'
    const sorters = {
      accessed_desc: (a, b) => (b.accessed_at || 0) - (a.accessed_at || 0),
      created_desc:  (a, b) => (b.created_at || 0)  - (a.created_at || 0),
      created_asc:   (a, b) => (a.created_at || 0)  - (b.created_at || 0),
      salience_desc: (a, b) => (b.salience || 0)    - (a.salience || 0),
    }
    if (sorters[sort]) memories.sort(sorters[sort])
    // Result count + time
    const dt = Math.round(performance.now() - t0)
    const counter = document.getElementById('memResultCount')
    if (counter) counter.textContent = `${memories.length} találat · ${dt} ms`
    renderMemories(memories, q)
  } catch (err) {
    console.error('Memória betöltés hiba:', err)
  }
}

function renderMemories(memories, query = '') {
  memList.innerHTML = ''
  memEmpty.hidden = memories.length > 0
  // Highlight helper — escapes content first, then wraps query matches in <mark>
  function highlight(text, q) {
    const safe = escapeHtml(text)
    if (!q) return safe
    const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return safe.replace(new RegExp(escapedQ, 'gi'), m => `<mark>${m}</mark>`)
  }
  // Make highlight available for content rendering (we will use innerHTML)
  window._memHighlight = (txt) => highlight(txt, query)

  for (const mem of memories) {
    const item = document.createElement('div')
    item.className = 'mem-item'

    const tier = mem.tier || mem.category || 'warm'
    const tierBadge = tierLabels[tier] || tier
    const badgeClass = 'badge-' + String(tier || '').replace(/[^a-z]/gi, '')
    const shortContent = mem.content.length > 120 ? mem.content.slice(0, 120) + '...' : mem.content
    const agentLabel = mem.agent_id || 'nova'

    // Build keywords HTML
    let keywordsHtml = ''
    if (mem.keywords) {
      const kws = typeof mem.keywords === 'string' ? mem.keywords.split(',').map(k => k.trim()).filter(Boolean) : mem.keywords
      if (kws.length > 0) {
        keywordsHtml = `<div class="mem-keywords">${kws.map(k => `<span class="mem-keyword-tag">${escapeHtml(k)}</span>`).join('')}</div>`
      }
    }

    item.innerHTML = `
      <div class="mem-item-header">
        <span class="badge ${badgeClass}">${tierBadge}</span>
        <span class="mem-agent-badge">${escapeHtml(agentLabel)}</span>
        <span class="mem-date">${escapeHtml(mem.created_label || '')}</span>
        ${typeof mem.salience === 'number' ? `<span class="mem-salience" title="Relevancia ertek">S: ${mem.salience.toFixed(2)}</span>` : ''}
      </div>
      <div class="mem-content-short">${escapeHtml(shortContent)}</div>
      <div class="mem-content-full">${(window._memHighlight || escapeHtml)(mem.content)}</div>
      ${keywordsHtml}
      <div class="mem-item-footer">
        <button class="btn-secondary" data-edit-memid="${mem.id}" style="padding:6px 14px; font-size:12px;">Szerkesztés</button>
        <button class="btn-danger" data-memid="${mem.id}" style="padding:6px 14px; font-size:12px;">Törlés</button>
      </div>
    `

    // Toggle expand
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-danger') || e.target.closest('.btn-secondary')) return
      item.classList.toggle('expanded')
    })

    // Edit
    const editBtn = item.querySelector('[data-edit-memid]')
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      document.getElementById('memModalTitle').textContent = t('Emlék szerkesztése')
      document.getElementById('memContent').value = mem.content
      document.getElementById('memTier').value = tier
      document.getElementById('memKeywords').value = mem.keywords || ''
      document.getElementById('memEditId').value = mem.id
      if (mem.agent_id) document.getElementById('memAgent').value = mem.agent_id
      openModal(memModalOverlay)
    })

    // Delete
    const delBtn = item.querySelector('.btn-danger')
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm('Biztosan törlöd ezt az emléket?')) return
      try {
        await fetch(`/api/memories/${mem.id}`, { method: 'DELETE' })
        showToast(t('Emlék törölve'), 3000, 'success')
        loadMemories()
        loadMemStats()
      } catch {
        showToast(t('Hiba a törlés során'), 3000, 'error')
      }
    })

    memList.appendChild(item)
  }
}

// === Memory Graph (Force-directed, Obsidian-style) ===

let graphNodes = []
let graphEdges = []
let graphSim = null
let graphCanvas = null
let graphCtx = null
let graphDragging = null
let graphHover = null
let graphSelectedNode = null
let graphSearchQuery = ''

// Zoom & pan state
let graphZoom = 1
let graphPanX = 0
let graphPanY = 0
let graphPanning = false
let graphPanStartX = 0
let graphPanStartY = 0
let graphZoomIndicatorTimer = null

// Edge animation
let graphAnimFrame = 0

const GRAPH_TIER_COLORS = {
  hot: '#dc3c3c',
  warm: '#d97757',
  cold: '#6a9bcc',
  shared: '#b0a040',
}

const GRAPH_TIER_BG = {
  hot: 'rgba(220, 60, 60, 0.06)',
  warm: 'rgba(217, 119, 87, 0.06)',
  cold: 'rgba(106, 155, 204, 0.06)',
  shared: 'rgba(176, 160, 64, 0.06)',
}

function screenToWorld(sx, sy) {
  return { x: (sx - graphPanX) / graphZoom, y: (sy - graphPanY) / graphZoom }
}

function worldToScreen(wx, wy) {
  return { x: wx * graphZoom + graphPanX, y: wy * graphZoom + graphPanY }
}

async function loadMemoryGraph() {
  const agent = document.getElementById('memAgentFilter').value
  const params = new URLSearchParams()
  if (agent) params.set('agent', agent)
  params.set('limit', '200')

  try {
    const res = await fetch(`/api/memories?${params}`)
    const memories = await res.json()

    const emptyEl = document.getElementById('graphEmpty')
    if (!memories || memories.length === 0) {
      emptyEl.hidden = false
      document.getElementById('memGraphCanvas').hidden = true
      return
    }
    emptyEl.hidden = true
    document.getElementById('memGraphCanvas').hidden = false

    // Reset zoom/pan on new data load
    graphZoom = 1
    graphPanX = 0
    graphPanY = 0
    graphSelectedNode = null
    hideGraphPanel()

    buildGraph(memories)
    startGraphSimulation()
  } catch (err) {
    console.error('Gráf betöltés hiba:', err)
  }
}

function buildGraph(memories) {
  graphNodes = []
  graphEdges = []

  const canvas = document.getElementById('memGraphCanvas')
  const rect = canvas.parentElement.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  canvas.style.width = rect.width + 'px'
  canvas.style.height = rect.height + 'px'
  graphCanvas = canvas
  graphCtx = canvas.getContext('2d')
  graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const w = rect.width
  const h = rect.height

  // Create nodes from memories
  for (const mem of memories) {
    const keywords = (mem.keywords || '').split(',').map(k => k.trim()).filter(Boolean)
    const label = mem.content.slice(0, 25).replace(/\n/g, ' ') + (mem.content.length > 25 ? '...' : '')
    graphNodes.push({
      id: mem.id,
      x: w / 2 + (Math.random() - 0.5) * w * 0.6,
      y: h / 2 + (Math.random() - 0.5) * h * 0.6,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      radius: 6,
      connectionCount: 0,
      label: label,
      tier: mem.tier || mem.category || 'warm',
      agent: mem.agent_id || 'nova',
      keywords: keywords,
      mem: mem,
      searchMatch: true,
    })
  }

  // Create edges based on shared keywords
  for (let i = 0; i < graphNodes.length; i++) {
    for (let j = i + 1; j < graphNodes.length; j++) {
      const a = graphNodes[i]
      const b = graphNodes[j]
      const shared = a.keywords.filter(k => b.keywords.includes(k))
      if (shared.length > 0) {
        graphEdges.push({ source: i, target: j, strength: shared.length })
        a.connectionCount += shared.length
        b.connectionCount += shared.length
      }
      // Also connect same-agent same-tier with low probability
      if (a.agent === b.agent && a.tier === b.tier && Math.random() < 0.3) {
        graphEdges.push({ source: i, target: j, strength: 0.5 })
        a.connectionCount += 0.5
        b.connectionCount += 0.5
      }
    }
  }

  // Set node radius based on connection count
  for (const node of graphNodes) {
    node.radius = 5 + Math.min(Math.sqrt(node.connectionCount) * 2.5, 14)
  }

  // Ensure controls hint and zoom indicator exist
  const graphView = document.getElementById('memGraphView')
  if (!graphView.querySelector('.graph-controls-hint')) {
    const hint = document.createElement('div')
    hint.className = 'graph-controls-hint'
    hint.innerHTML = 'Scroll: zoom | Drag: move nodes<br>Click: details | Dbl-click: edit'
    graphView.appendChild(hint)
  }
  if (!graphView.querySelector('.graph-zoom-indicator')) {
    const zi = document.createElement('div')
    zi.className = 'graph-zoom-indicator'
    zi.id = 'graphZoomIndicator'
    graphView.appendChild(zi)
  }

  // A11y: summarize the graph as text for screen readers
  const alt = document.getElementById('memGraphTextAlt')
  if (alt) {
    const tierCount = graphNodes.reduce((acc, n) => { acc[n.tier] = (acc[n.tier] || 0) + 1; return acc }, {})
    const tierSummary = Object.entries(tierCount).map(([t, c]) => `${c} ${t}`).join(', ')
    const edgeCount = graphEdges.length
    alt.textContent = `Memória gráf: ${graphNodes.length} emlék (${tierSummary}), ${edgeCount} kapcsolat közös kulcsszavak alapján. A gráf vizuális; részletekhez használd a Hot/Warm/Cold/Shared listanézeteket.`
  }
}

function startGraphSimulation() {
  if (graphSim) cancelAnimationFrame(graphSim)

  let frame = 0
  const maxFrames = 300

  function tick() {
    if (frame > maxFrames) {
      renderGraph()
      return
    }
    frame++
    graphAnimFrame = frame
    const damping = 0.95 + (frame / maxFrames) * 0.04

    const w = graphCanvas.width / (window.devicePixelRatio || 1)
    const h = graphCanvas.height / (window.devicePixelRatio || 1)
    const nodes = graphNodes

    // Tier clustering force: gently push same-tier nodes toward each other
    const tierCenters = {}
    for (const node of nodes) {
      if (!tierCenters[node.tier]) tierCenters[node.tier] = { x: 0, y: 0, count: 0 }
      tierCenters[node.tier].x += node.x
      tierCenters[node.tier].y += node.y
      tierCenters[node.tier].count++
    }
    for (const tier of Object.keys(tierCenters)) {
      tierCenters[tier].x /= tierCenters[tier].count
      tierCenters[tier].y /= tierCenters[tier].count
    }
    for (const node of nodes) {
      const tc = tierCenters[node.tier]
      if (tc) {
        node.vx += (tc.x - node.x) * 0.0005
        node.vy += (tc.y - node.y) * 0.0005
      }
    }

    // Repulsion (all nodes push each other away)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x
        let dy = nodes[j].y - nodes[i].y
        let dist = Math.sqrt(dx * dx + dy * dy) || 1
        let force = 800 / (dist * dist)
        let fx = (dx / dist) * force
        let fy = (dy / dist) * force
        nodes[i].vx -= fx
        nodes[i].vy -= fy
        nodes[j].vx += fx
        nodes[j].vy += fy
      }
    }

    // Attraction (edges pull connected nodes together)
    for (const edge of graphEdges) {
      const a = nodes[edge.source]
      const b = nodes[edge.target]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let dist = Math.sqrt(dx * dx + dy * dy) || 1
      let force = (dist - 80) * 0.005 * edge.strength
      let fx = (dx / dist) * force
      let fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    // Center gravity
    for (const node of nodes) {
      node.vx += (w / 2 - node.x) * 0.001
      node.vy += (h / 2 - node.y) * 0.001
    }

    // Apply velocity with damping
    for (const node of nodes) {
      if (node === graphDragging) continue
      node.vx *= damping
      node.vy *= damping
      node.x += node.vx
      node.y += node.vy
      // Bounds (allow overflow for panning)
      node.x = Math.max(-200, Math.min(w + 200, node.x))
      node.y = Math.max(-200, Math.min(h + 200, node.y))
    }

    renderGraph()
    graphSim = requestAnimationFrame(tick)
  }

  tick()
}

function renderGraph() {
  const ctx = graphCtx
  const dpr = window.devicePixelRatio || 1
  const w = graphCanvas.width / dpr
  const h = graphCanvas.height / dpr

  ctx.clearRect(0, 0, w, h)

  const cs = getComputedStyle(document.documentElement)
  const borderColor = cs.getPropertyValue('--border').trim() || '#d1cfc5'
  const textColor = cs.getPropertyValue('--text').trim() || '#141413'
  const textMuted = cs.getPropertyValue('--text-muted').trim() || '#87867f'
  const bgCard = cs.getPropertyValue('--bg-card').trim() || '#fff'
  const bgColor = cs.getPropertyValue('--bg').trim() || '#faf9f5'
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'

  // === Dot grid background (drawn in screen space) ===
  const gridSize = 20
  const dotColor = borderColor
  ctx.fillStyle = dotColor
  ctx.globalAlpha = isDark ? 0.2 : 0.3
  const offsetX = ((graphPanX % (gridSize * graphZoom)) + gridSize * graphZoom) % (gridSize * graphZoom)
  const offsetY = ((graphPanY % (gridSize * graphZoom)) + gridSize * graphZoom) % (gridSize * graphZoom)
  const scaledGrid = gridSize * graphZoom
  if (scaledGrid > 4) {
    for (let x = offsetX; x < w; x += scaledGrid) {
      for (let y = offsetY; y < h; y += scaledGrid) {
        ctx.beginPath()
        ctx.arc(x, y, Math.max(0.5, graphZoom * 0.6), 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.globalAlpha = 1

  // === Apply zoom/pan transform ===
  ctx.save()
  ctx.translate(graphPanX, graphPanY)
  ctx.scale(graphZoom, graphZoom)

  const hasSearch = graphSearchQuery.length > 0

  // === Tier cluster backgrounds ===
  const tierGroups = {}
  for (const node of graphNodes) {
    if (!tierGroups[node.tier]) tierGroups[node.tier] = []
    tierGroups[node.tier].push(node)
  }
  for (const [tier, nodes] of Object.entries(tierGroups)) {
    if (nodes.length < 2) continue
    let cx = 0, cy = 0
    for (const n of nodes) { cx += n.x; cy += n.y }
    cx /= nodes.length
    cy /= nodes.length
    let maxDist = 0
    for (const n of nodes) {
      const d = Math.sqrt((n.x - cx) ** 2 + (n.y - cy) ** 2)
      if (d > maxDist) maxDist = d
    }
    const radius = maxDist + 60
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    const bgTier = GRAPH_TIER_BG[tier] || 'rgba(128,128,128,0.04)'
    grad.addColorStop(0, bgTier)
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.globalAlpha = hasSearch ? 0.3 : 0.8
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // Build set of connected node indices for hovered/selected node
  const connectedToActive = new Set()
  const activeNode = graphHover || graphSelectedNode
  if (activeNode) {
    const activeIdx = graphNodes.indexOf(activeNode)
    for (const edge of graphEdges) {
      if (edge.source === activeIdx) connectedToActive.add(edge.target)
      if (edge.target === activeIdx) connectedToActive.add(edge.source)
    }
  }

  // === Draw edges (bezier curves with pulsing) ===
  const time = Date.now() * 0.001
  for (const edge of graphEdges) {
    const a = graphNodes[edge.source]
    const b = graphNodes[edge.target]

    const isActiveEdge = activeNode && (a === activeNode || b === activeNode)
    const searchFaded = hasSearch && (!a.searchMatch || !b.searchMatch)

    // Edge thickness based on connection strength
    const baseWidth = 0.5 + Math.min(edge.strength * 0.6, 2.5)

    // Subtle pulse/breathe animation
    const pulse = 0.85 + 0.15 * Math.sin(time * 1.5 + edge.source * 0.3 + edge.target * 0.7)

    ctx.lineWidth = isActiveEdge ? baseWidth * 1.8 : baseWidth * pulse
    ctx.strokeStyle = isActiveEdge ? GRAPH_TIER_COLORS[a === activeNode ? a.tier : b.tier] || borderColor : borderColor
    ctx.globalAlpha = searchFaded ? 0.05 : (isActiveEdge ? 0.7 : (0.15 + Math.min(edge.strength * 0.1, 0.3)) * pulse)

    // Bezier curve: midpoint offset perpendicular to the line
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    const curvature = Math.min(dist * 0.15, 30)
    // Perpendicular offset
    const cpx = mx + (-dy / dist) * curvature
    const cpy = my + (dx / dist) * curvature

    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.quadraticCurveTo(cpx, cpy, b.x, b.y)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // === Draw nodes ===
  const fontSize = Math.max(8, Math.min(12, 10 / graphZoom))

  for (let ni = 0; ni < graphNodes.length; ni++) {
    const node = graphNodes[ni]
    const color = GRAPH_TIER_COLORS[node.tier] || '#d97757'
    const isHover = node === graphHover
    const isSelected = node === graphSelectedNode
    const isConnected = connectedToActive.has(ni)
    const searchFaded = hasSearch && !node.searchMatch
    const searchGlow = hasSearch && node.searchMatch

    // Opacity
    let nodeAlpha = 0.85
    if (searchFaded) nodeAlpha = 0.12
    else if (searchGlow) nodeAlpha = 1
    else if (isHover || isSelected) nodeAlpha = 1
    else if (activeNode && !isConnected) nodeAlpha = 0.35

    // Glow effect for hover, selected, search match
    if ((isHover || isSelected || searchGlow) && !searchFaded) {
      ctx.shadowColor = color
      ctx.shadowBlur = isHover ? 20 : (searchGlow ? 15 : 10)
    }

    // Connected nodes get subtle highlight
    if (isConnected && !searchFaded) {
      ctx.shadowColor = color
      ctx.shadowBlur = 6
    }

    const r = isHover ? node.radius + 3 : (isSelected ? node.radius + 2 : node.radius)

    // Node fill
    ctx.fillStyle = color
    ctx.globalAlpha = nodeAlpha
    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
    ctx.fill()

    // Subtle border ring for selected
    if (isSelected) {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.globalAlpha = 0.6
      ctx.beginPath()
      ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'

    // === Always show label (pill/badge style) ===
    if (!searchFaded || (searchFaded && nodeAlpha > 0.15)) {
      const labelText = node.label
      const labelFontSize = Math.max(7, Math.min(11, 9 / Math.max(graphZoom * 0.7, 0.5)))
      ctx.font = (isHover || isSelected) ? `600 ${labelFontSize + 1}px -apple-system, sans-serif` : `500 ${labelFontSize}px -apple-system, sans-serif`
      const textWidth = ctx.measureText(labelText).width
      const pillW = textWidth + 10
      const pillH = labelFontSize + 6
      const pillX = node.x - pillW / 2
      const pillY = node.y + r + 5

      // Dark pill background
      ctx.globalAlpha = searchFaded ? 0.08 : ((isHover || isSelected) ? 0.9 : 0.65)
      ctx.fillStyle = isDark ? 'rgba(20,20,19,0.85)' : 'rgba(30,30,28,0.8)'
      graphRoundRect(ctx, pillX, pillY, pillW, pillH, 3)
      ctx.fill()

      // White text
      ctx.fillStyle = isDark ? '#e8e7e0' : '#faf9f5'
      ctx.globalAlpha = searchFaded ? 0.1 : ((isHover || isSelected) ? 1 : 0.85)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(labelText, node.x, pillY + pillH / 2)
    }

    ctx.globalAlpha = 1
    ctx.textBaseline = 'alphabetic'
  }

  // Hover tooltip (richer than before)
  if (graphHover && !graphSelectedNode) {
    const node = graphHover
    const tLabels = { hot: 'Hot', warm: 'Warm', cold: 'Cold', shared: 'Shared' }
    const text = `${tLabels[node.tier] || node.tier} | ${node.agent}`
    const kw = node.keywords.length > 0 ? node.keywords.join(', ') : ''
    const conns = `${Math.round(node.connectionCount)} connections`

    ctx.font = 'bold 11px -apple-system, sans-serif'
    const tw = Math.max(ctx.measureText(text).width, kw ? ctx.measureText(kw).width : 0, ctx.measureText(conns).width) + 24
    const th = kw ? 64 : 48
    let tx = node.x - tw / 2
    let ty = node.y - node.radius - th - 12

    // Tooltip background
    ctx.fillStyle = isDark ? 'rgba(31,30,29,0.95)' : 'rgba(255,255,255,0.96)'
    ctx.strokeStyle = borderColor
    ctx.lineWidth = 1
    ctx.shadowColor = 'rgba(0,0,0,0.15)'
    ctx.shadowBlur = 12
    graphRoundRect(ctx, tx, ty, tw, th, 8)
    ctx.fill()
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'

    ctx.fillStyle = textColor
    ctx.font = 'bold 11px -apple-system, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(text, tx + 12, ty + 18)
    ctx.font = '10px -apple-system, sans-serif'
    ctx.fillStyle = textMuted
    ctx.fillText(conns, tx + 12, ty + 34)
    if (kw) {
      ctx.fillText(kw.length > 40 ? kw.slice(0, 40) + '...' : kw, tx + 12, ty + 50)
    }
  }

  ctx.restore()
}

function graphRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// === Graph detail panel ===
function showGraphPanel(node) {
  let panel = document.getElementById('graphPanel')
  if (!panel) {
    panel = document.createElement('div')
    panel.id = 'graphPanel'
    panel.className = 'graph-panel'
    document.getElementById('memGraphView').appendChild(panel)
  }
  const tierLabelsMap = { hot: 'Hot', warm: 'Warm', cold: 'Cold', shared: 'Shared' }
  const created = node.mem.created_label || ''
  panel.innerHTML = `
    <div class="graph-panel-header">
      <span class="badge badge-${escapeHtml(String(node.tier || ''))}">${escapeHtml(tierLabelsMap[node.tier] || node.tier || '')}</span>
      <span class="graph-panel-agent">${escapeHtml(node.agent)}</span>
      <button class="graph-panel-close" id="graphPanelCloseBtn">&times;</button>
    </div>
    ${created ? `<div class="graph-panel-date">${escapeHtml(created)}</div>` : ''}
    <div class="graph-panel-content">${escapeHtml(node.mem.content)}</div>
    <div class="graph-panel-meta">
      ${node.keywords.length ? '<div class="graph-panel-keywords">' + node.keywords.map(k => '<span class="mem-keyword-tag">' + escapeHtml(k) + '</span>').join('') + '</div>' : ''}
    </div>
  `
  panel.hidden = false
  document.getElementById('graphPanelCloseBtn').addEventListener('click', () => {
    graphSelectedNode = null
    panel.hidden = true
    renderGraph()
  })
}

function hideGraphPanel() {
  const panel = document.getElementById('graphPanel')
  if (panel) panel.hidden = true
}

function openEditMemory(mem) {
  document.getElementById('memModalTitle').textContent = t('Emlék szerkesztése')
  document.getElementById('memAgent').value = mem.agent_id || 'nova'
  document.getElementById('memTier').value = mem.tier || mem.category || 'warm'
  document.getElementById('memContent').value = mem.content || ''
  document.getElementById('memKeywords').value = mem.keywords || ''
  document.getElementById('memEditId').value = mem.id
  openModal(memModalOverlay)
}

// === Graph search integration ===
function updateGraphSearch() {
  const q = memSearchInput.value.trim().toLowerCase()
  graphSearchQuery = q
  for (const node of graphNodes) {
    if (!q) {
      node.searchMatch = true
    } else {
      const content = (node.mem.content || '').toLowerCase()
      const kws = node.keywords.join(' ').toLowerCase()
      const agent = (node.agent || '').toLowerCase()
      node.searchMatch = content.includes(q) || kws.includes(q) || agent.includes(q)
    }
  }
  if (graphNodes.length > 0) renderGraph()
}

// === Zoom indicator ===
function showZoomIndicator() {
  const el = document.getElementById('graphZoomIndicator')
  if (!el) return
  el.textContent = `${Math.round(graphZoom * 100)}%`
  el.classList.add('visible')
  clearTimeout(graphZoomIndicatorTimer)
  graphZoomIndicatorTimer = setTimeout(() => el.classList.remove('visible'), 1200)
}

// === Graph mouse interaction (with zoom/pan) ===
;(function initGraphInteraction() {
  const canvas = document.getElementById('memGraphCanvas')
  let wasDragging = false
  let wasPanning = false
  let mouseDownPos = { x: 0, y: 0 }

  // Mouse wheel zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    // Zoom toward cursor
    const worldX = (mx - graphPanX) / graphZoom
    const worldY = (my - graphPanY) / graphZoom

    graphZoom = Math.max(0.3, Math.min(3.0, graphZoom * zoomFactor))

    graphPanX = mx - worldX * graphZoom
    graphPanY = my - worldY * graphZoom

    showZoomIndicator()
    if (graphNodes.length > 0) renderGraph()
  }, { passive: false })

  // Mouse move: hover detection + panning + dragging
  canvas.addEventListener('mousemove', (e) => {
    const rect = e.target.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top

    // Panning
    if (graphPanning) {
      const dx = sx - graphPanStartX
      const dy = sy - graphPanStartY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasPanning = true
      graphPanX += dx
      graphPanY += dy
      graphPanStartX = sx
      graphPanStartY = sy
      if (graphNodes.length > 0) renderGraph()
      return
    }

    // Dragging a node
    const world = screenToWorld(sx, sy)
    if (graphDragging) {
      const dx = sx - mouseDownPos.x
      const dy = sy - mouseDownPos.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasDragging = true
      graphDragging.x = world.x
      graphDragging.y = world.y
      graphDragging.vx = 0
      graphDragging.vy = 0
      if (graphNodes.length > 0) renderGraph()
      return
    }

    // Hover detection in world space
    graphHover = null
    for (const node of graphNodes) {
      const ndx = world.x - node.x
      const ndy = world.y - node.y
      const hitRadius = (node.radius + 6) / Math.max(graphZoom, 0.5)
      if (ndx * ndx + ndy * ndy < hitRadius * hitRadius) {
        graphHover = node
        break
      }
    }
    canvas.style.cursor = graphHover ? 'pointer' : 'grab'
    if (graphNodes.length > 0) renderGraph()
  })

  // Mouse down: start drag on node, or start pan on empty space
  canvas.addEventListener('mousedown', (e) => {
    const rect = e.target.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    mouseDownPos = { x: sx, y: sy }
    wasDragging = false
    wasPanning = false

    if (graphHover) {
      // Drag node
      graphDragging = graphHover
      canvas.style.cursor = 'grabbing'
    } else {
      // Pan
      graphPanning = true
      graphPanStartX = sx
      graphPanStartY = sy
      canvas.style.cursor = 'grabbing'
    }
  })

  // Click: select node and show panel (only if not dragged/panned)
  canvas.addEventListener('click', (e) => {
    if (wasDragging || wasPanning) return

    const rect = e.target.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const world = screenToWorld(sx, sy)

    let clicked = null
    for (const node of graphNodes) {
      const dx = world.x - node.x
      const dy = world.y - node.y
      const hitRadius = (node.radius + 6) / Math.max(graphZoom, 0.5)
      if (dx * dx + dy * dy < hitRadius * hitRadius) {
        clicked = node
        break
      }
    }

    if (clicked) {
      graphSelectedNode = clicked
      showGraphPanel(clicked)
    } else {
      graphSelectedNode = null
      hideGraphPanel()
    }
    if (graphNodes.length > 0) renderGraph()
  })

  // Double click: open edit modal
  canvas.addEventListener('dblclick', (e) => {
    if (graphHover && graphHover.mem) {
      openEditMemory(graphHover.mem)
    }
  })

  // Mouse up: stop drag/pan
  document.addEventListener('mouseup', () => {
    if (graphDragging) {
      graphDragging = null
      const c = document.getElementById('memGraphCanvas')
      if (c) c.style.cursor = graphHover ? 'pointer' : 'grab'
    }
    if (graphPanning) {
      graphPanning = false
      const c = document.getElementById('memGraphCanvas')
      if (c) c.style.cursor = 'grab'
    }
  })

  // Search integration: listen to existing search input
  memSearchInput.addEventListener('input', () => {
    if (currentMemTier === 'graph') {
      updateGraphSearch()
    }
  })
  memSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && currentMemTier === 'graph') {
      updateGraphSearch()
    }
  })
})()

// === SVG icons ===
function pauseIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
}
function playIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
}
function trashIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>'
}

// ============================================================
// === Connectors ===
// ============================================================

var connectorGrid = document.getElementById('connectorGrid')
var connectorStats = document.getElementById('connectorStats')
const connectorModalOverlay = document.getElementById('connectorModalOverlay')
const connectorDetailOverlay = document.getElementById('connectorDetailOverlay')
var connectors = []

// Modal wiring
document.getElementById('addConnectorBtn').addEventListener('click', () => {
  document.getElementById('connectorName').value = ''
  document.getElementById('connectorUrl').value = ''
  document.getElementById('connectorCmd').value = ''
  document.getElementById('connectorArgs').value = ''
  document.getElementById('connectorType').value = 'remote'
  document.getElementById('connectorScope').value = 'user'
  document.getElementById('connectorUrlGroup').hidden = false
  document.getElementById('connectorCmdGroup').hidden = true
  document.getElementById('connectorArgsGroup').hidden = true
  openModal(connectorModalOverlay)
})
document.getElementById('connectorModalClose').addEventListener('click', () => closeModal(connectorModalOverlay))
document.getElementById('connectorDetailClose').addEventListener('click', () => closeModal(connectorDetailOverlay))
connectorModalOverlay.addEventListener('click', (e) => { if (e.target === connectorModalOverlay) closeModal(connectorModalOverlay) })
connectorDetailOverlay.addEventListener('click', (e) => { if (e.target === connectorDetailOverlay) closeModal(connectorDetailOverlay) })

// Type toggle
document.getElementById('connectorType').addEventListener('change', () => {
  const isLocal = document.getElementById('connectorType').value === 'local'
  document.getElementById('connectorUrlGroup').hidden = isLocal
  document.getElementById('connectorCmdGroup').hidden = !isLocal
  document.getElementById('connectorArgsGroup').hidden = !isLocal
})

async function loadConnectors() {
  if (!connectorGrid) connectorGrid = document.getElementById('connectorGrid')
  if (!connectorStats) connectorStats = document.getElementById('connectorStats')
  if (!connectorGrid) return
  connectorGrid.innerHTML = '<div class="connector-loading"><span class="spinner"></span> Connectorok betoltese...</div>'
  connectorStats.innerHTML = ''
  try {
    const res = await fetch('/api/connectors')
    connectors = await res.json()
    renderConnectors()
  } catch (err) {
    console.error('Connector betöltés hiba:', err)
    connectorGrid.innerHTML = `<div class="connector-loading">${currentLang === 'en' ? 'Failed to load' : 'Hiba a betöltés során'}</div>`
  }
}

const BUILTIN_MCPS = [
  { name: 'computer-use', label: 'Computer Use', desc: 'Képernyő vezérlés, kattintás, gépelés', enableHint: 'Engedélyezés: tmux attach -> /mcp -> computer-use -> Enable' },
  { name: 'chrome', label: 'Claude in Chrome', desc: 'Böngésző automatizálás', enableHint: '--chrome flag-gel indítva' },
]

function renderConnectors() {
  // Builtin grid
  const builtinGrid = document.getElementById('connectorBuiltinGrid')
  builtinGrid.innerHTML = ''
  for (const b of BUILTIN_MCPS) {
    const isActive = connectors.some(c => c.name.toLowerCase().includes(b.name))
    const div = document.createElement('div')
    div.className = 'connector-builtin'
    div.innerHTML = `
      <div class="connector-status-dot ${isActive ? 'connected' : 'unknown'}"></div>
      <div class="connector-builtin-name">${escapeHtml(b.label)}<br><span style="font-size:11px;color:var(--text-muted);font-weight:400">${escapeHtml(b.desc)}</span></div>
      <span class="connector-builtin-action" title="${escapeHtml(b.enableHint)}">${isActive ? t('Aktív') : t('Kikapcsolva')}</span>
    `
    builtinGrid.appendChild(div)
  }

  // Stats — configured + connected mind 'aktiv', needs_auth + failed kiemelve
  const connected = connectors.filter(c => c.status === 'connected').length
  const configured = connectors.filter(c => c.status === 'configured').length
  const needsAuth = connectors.filter(c => c.status === 'needs_auth').length
  const failed = connectors.filter(c => c.status === 'failed').length
  const activeTotal = connected + configured
  connectorStats.innerHTML = `
    <div class="stat-card"><div class="stat-value">${connectors.length}</div><div class="stat-label">${t('Összes')}</div></div>
    <div class="stat-card"><div class="stat-value" style="color:var(--success)">${activeTotal}</div><div class="stat-label">${t('Aktív')}</div></div>
    ${needsAuth ? `<div class="stat-card"><div class="stat-value" style="color:var(--accent)">${needsAuth}</div><div class="stat-label">${t('Auth szükséges')}</div></div>` : ''}
    ${failed ? `<div class="stat-card"><div class="stat-value" style="color:var(--danger)">${failed}</div><div class="stat-label">${t('Hibás')}</div></div>` : ''}
  `

  // Grid
  connectorGrid.innerHTML = ''
  if (connectors.length === 0) {
    connectorGrid.innerHTML = `<div class="connector-loading">${t('Nincsenek MCP connectorok')}</div>`
    return
  }
  // Endpoint readability mapping
  function endpointLabel(c) {
    const ep = (c.endpoint || '').trim()
    if (!ep) return c.type === 'plugin' ? t('Plugin') : ''
    if (ep.startsWith('http://') || ep.startsWith('https://')) return ep
    if (ep === 'plugin') return t('Beépített plugin')
    if (ep === 'npx') return 'npx (npm package)'
    if (ep === 'node') return 'node (helyi script)'
    if (ep === 'bun' || ep.startsWith('bun ')) return 'bun (Bun runtime)'
    if (ep === 'local') return t('Helyi parancs')
    return ep
  }
  // Status pill labels
  const statusLabels = {
    connected: { txt: t('Aktív'), color: 'var(--success)' },
    configured: { txt: t('Beállítva'), color: 'var(--success)' },
    needs_auth: { txt: t('Auth kell'), color: 'var(--accent)' },
    failed: { txt: t('Hibás'), color: 'var(--danger)' },
    unknown: { txt: t('Ismeretlen'), color: 'var(--text-muted)' },
  }
  for (const c of connectors) {
    const card = document.createElement('div')
    card.className = 'connector-card'
    const sl = statusLabels[c.status] || statusLabels.unknown
    card.innerHTML = `
      <div class="connector-status-dot ${c.status}" title="${sl.txt}"></div>
      <div class="connector-info">
        <div class="connector-name">${escapeHtml(c.name)}</div>
        <div class="connector-endpoint" title="${escapeHtml(c.endpoint || '')}">${escapeHtml(endpointLabel(c))}</div>
      </div>
      <span class="connector-type-badge ${c.type}" title="${escapeHtml(c.type || '')}">${escapeHtml(c.type || '')}</span>
      <span class="connector-status-pill" style="color:${sl.color}">${sl.txt}</span>
    `
    card.addEventListener('click', () => openConnectorDetail(c))
    connectorGrid.appendChild(card)
  }
}

async function openConnectorDetail(connector) {
  document.getElementById('connectorDetailTitle').textContent = connector.name

  // Fetch detailed info
  try {
    const res = await fetch(`/api/connectors/${encodeURIComponent(connector.name)}`)
    const detail = await res.json()

    const statusLabels = { connected: t('Csatlakozva'), needs_auth: t('Auth szükséges'), failed: t('Hiba'), unknown: t('Ismeretlen') }
    const statusColors = { connected: 'var(--success)', needs_auth: 'var(--accent)', failed: 'var(--danger)', unknown: 'var(--text-muted)' }

    document.getElementById('connectorDetailInfo').innerHTML = `
      <div class="connector-detail-row">
        <span class="meta-label">${t('Státusz')}</span>
        <span class="meta-value" style="color:${statusColors[detail.status] || ''}">${statusLabels[detail.status] || detail.status}</span>
      </div>
      <div class="connector-detail-row">
        <span class="meta-label">${t('Hatókör')}</span>
        <span class="meta-value">${escapeHtml(detail.scope || '-')}</span>
      </div>
      ${detail.type ? `<div class="connector-detail-row"><span class="meta-label">${t('Típus')}</span><span class="meta-value">${escapeHtml(detail.type)}</span></div>` : ''}
      ${detail.command ? `<div class="connector-detail-row"><span class="meta-label">${t('Parancs')}</span><span class="meta-value" style="font-family:monospace;font-size:12px">${escapeHtml(detail.command)} ${escapeHtml(detail.args || '')}</span></div>` : ''}
      ${Object.keys(detail.env || {}).length ? `<div class="connector-detail-row"><span class="meta-label">Env</span><span class="meta-value" style="font-family:monospace;font-size:11px">${Object.entries(detail.env).map(([k,v]) => escapeHtml(`${k}=${v}`)).join(', ')}</span></div>` : ''}
    `
  } catch {
    document.getElementById('connectorDetailInfo').innerHTML = `<p>${t('Részletek betöltése sikertelen')}</p>`
  }

  // Agent assignment
  try {
    const agentsRes = await fetch('/api/schedules/agents')
    const allAgents = await agentsRes.json()
    const assignableAgents = allAgents.filter(a => a.name !== 'nova')

    const listEl = document.getElementById('connectorAgentList')
    listEl.innerHTML = ''
    if (assignableAgents.length === 0) {
      listEl.innerHTML = `<p style="color:var(--text-muted);font-size:13px">${t('Nincsenek hozzárendelhető ágensek')}</p>`
    } else {
      for (const agent of assignableAgents) {
        const item = document.createElement('div')
        item.className = 'connector-agent-item'
        item.innerHTML = `
          <input type="checkbox" id="assign-${agent.name}" value="${agent.name}">
          <label for="assign-${agent.name}">${escapeHtml(agent.label || agent.name)}</label>
        `
        listEl.appendChild(item)
      }
    }
  } catch {
    document.getElementById('connectorAgentList').innerHTML = ''
  }

  // Delete button
  document.getElementById('connectorDeleteBtn').onclick = async () => {
    if (!confirm(`Biztosan törlöd: ${connector.name}?`)) return
    try {
      await fetch(`/api/connectors/${encodeURIComponent(connector.name)}`, { method: 'DELETE' })
      closeModal(connectorDetailOverlay)
      showToast(t('Connector törölve'), 3000, 'success')
      loadConnectors()
    } catch {
      showToast(t('Hiba a törlés során'), 3000, 'error')
    }
  }

  // Assign button
  document.getElementById('connectorAssignBtn').onclick = async () => {
    const checked = [...document.querySelectorAll('#connectorAgentList input:checked')].map(i => i.value)
    if (checked.length === 0) { showToast(t('Válassz legalább egy ágenst')); return }
    try {
      await fetch(`/api/connectors/${encodeURIComponent(connector.name)}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: checked }),
      })
      showToast('Connector hozzarendelve')
    } catch {
      showToast(t('Hiba a hozzárendelés során'), 3000, 'error')
    }
  }

  openModal(connectorDetailOverlay)
}

// Save new connector
document.getElementById('saveConnectorBtn').addEventListener('click', async () => {
  const name = document.getElementById('connectorName').value.trim()
  const type = document.getElementById('connectorType').value
  const scope = document.getElementById('connectorScope').value

  if (!name) { document.getElementById('connectorName').focus(); return }

  const data = { name, type, scope }
  if (type === 'remote') {
    data.url = document.getElementById('connectorUrl').value.trim()
    if (!data.url) { document.getElementById('connectorUrl').focus(); return }
  } else {
    data.command = document.getElementById('connectorCmd').value.trim()
    data.args = document.getElementById('connectorArgs').value.trim()
    if (!data.command) { document.getElementById('connectorCmd').focus(); return }
  }

  const btn = document.getElementById('saveConnectorBtn')
  btn.disabled = true
  btn.querySelector('.btn-text').hidden = true
  btn.querySelector('.btn-loading').hidden = false

  try {
    const res = await fetch('/api/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Hiba')
    }
    closeModal(connectorModalOverlay)
    showToast(t('Connector hozzáadva!'), 3000, 'success')
    loadConnectors()
  } catch (err) {
    showToast(`Hiba: ${err.message}`, 3000, 'error')
  } finally {
    btn.disabled = false
    btn.querySelector('.btn-text').hidden = false
    btn.querySelector('.btn-loading').hidden = true
  }
})

// === Helpers ===
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }

function escapeHtml(str) {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

// ============================================================
// === Status ===
// ============================================================

const CLAUDE_SERVICES = [
  { name: 'claude.ai', label: 'Claude.ai' },
  { name: 'api', label: 'Claude API' },
  { name: 'code', label: 'Claude Code' },
  { name: 'platform', label: 'Platform' },
  { name: 'cowork', label: 'Claude Cowork' },
  { name: 'gov', label: 'Claude for Gov' },
]

document.getElementById('refreshStatusBtn').addEventListener('click', loadStatus)

async function loadStatus() {
  const overallEl = document.getElementById('statusOverall')
  const gridEl = document.getElementById('statusServiceGrid')
  const listEl = document.getElementById('statusIncidentList')

  overallEl.className = 'status-overall unknown'
  overallEl.textContent = t('Betöltés...')
  gridEl.innerHTML = ''
  listEl.innerHTML = ''

  try {
    const res = await fetch('/api/status')
    const data = await res.json()

    // Overall status
    const overallLabels = {
      operational: t('Minden szolgáltatás működik'),
      degraded: t('Aktiv incidens'),
      unknown: t('Státusz nem elérhető'),
    }
    overallEl.className = `status-overall ${data.overall}`
    overallEl.textContent = overallLabels[data.overall] || data.overall

    // Services grid (static list with status derived from incidents)
    const activeIssues = data.incidents.filter(i => i.status !== 'resolved')
    for (const svc of CLAUDE_SERVICES) {
      const affected = activeIssues.some(i =>
        i.title.toLowerCase().includes(svc.name) ||
        i.description.toLowerCase().includes(svc.name)
      )
      const div = document.createElement('div')
      div.className = 'status-service'
      div.innerHTML = `
        <div class="status-service-dot ${affected ? 'degraded' : 'operational'}"></div>
        <span class="status-service-name">${escapeHtml(svc.label)}</span>
      `
      gridEl.appendChild(div)
    }

    // Incidents - only show active (non-resolved)
    if (data.incidents.length === 0) {
      listEl.innerHTML = `<div class="status-loading" style="color:var(--success)">${t('Nincs aktív incidens — minden rendben működik.')}</div>`
    } else {
      for (const inc of data.incidents) {
        const statusLabels = {
          monitoring: t('Figyelés'),
          identified: t('Azonosítva'),
          investigating: t('Vizsgálat'),
        }
        const div = document.createElement('div')
        div.className = `status-incident ${inc.status}`
        const date = new Date(inc.pubDate).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest' })
        div.innerHTML = `
          <div class="status-incident-header">
            <span class="status-incident-title">${escapeHtml(inc.title)}</span>
            <span class="status-incident-badge ${escapeHtml(String(inc.status || '').replace(/[^a-z_]/gi, ''))}">${escapeHtml(statusLabels[inc.status] || inc.status || '')}</span>
          </div>
          <div class="status-incident-desc">${escapeHtml(inc.description.slice(0, 300))}</div>
          <div class="status-incident-date">${date}</div>
        `
        listEl.appendChild(div)
      }
    }
  } catch (err) {
    overallEl.className = 'status-overall unknown'
    overallEl.textContent = t('Nem sikerült betölteni a státuszt')
  }

}

async function loadUsageStats() {
  const days = parseInt(document.getElementById('usageDaysSelect').value) || 30
  try {
    const res = await fetch(`/api/usage?days=${days}`)
    const data = await res.json()

    // Totals
    const totalsEl = document.getElementById('usageTotals')
    const formatNum = (n) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
    totalsEl.innerHTML = `
      <div class="usage-stat">
        <div class="usage-stat-value">$${data.totalCost.toFixed(2)}</div>
        <div class="usage-stat-label">${t('Összköltség')}</div>
      </div>
      <div class="usage-stat">
        <div class="usage-stat-value">${formatNum(data.totalInput)}</div>
        <div class="usage-stat-label">${t('Input tokenek')}</div>
      </div>
      <div class="usage-stat">
        <div class="usage-stat-value">${formatNum(data.totalOutput)}</div>
        <div class="usage-stat-label">${t('Output tokenek')}</div>
      </div>
      <div class="usage-stat">
        <div class="usage-stat-value">${data.entries}</div>
        <div class="usage-stat-label">${t('Kérések')}</div>
      </div>
    `

    // Chart
    const chartEl = document.getElementById('usageChart')
    chartEl.innerHTML = ''
    if (data.daily.length === 0) {
      chartEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:40px;text-align:center">${t('Nincs adat')}</div>`
    } else {
      const maxTokens = Math.max(...data.daily.map(d => d.tokens), 1)
      const reversed = [...data.daily].reverse()
      for (const day of reversed) {
        const h = Math.max(2, Math.round((day.tokens / maxTokens) * 100))
        const bar = document.createElement('div')
        bar.className = 'usage-bar'
        bar.style.height = h + '%'
        bar.innerHTML = `<div class="usage-bar-tip">${escapeHtml(String(day.date || ''))}<br>${formatNum(day.tokens)} token | $${day.cost.toFixed(3)}</div>`
        chartEl.appendChild(bar)
      }
    }

    // Table
    const tbody = document.querySelector('#usageTable tbody')
    tbody.innerHTML = ''
    for (const day of data.daily) {
      const tr = document.createElement('tr')
      tr.innerHTML = `
        <td>${escapeHtml(String(day.date || ''))}</td>
        <td>${formatNum(day.tokens)}</td>
        <td>$${day.cost.toFixed(3)}</td>
      `
      tbody.appendChild(tr)
    }
    if (data.daily.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Nincs adat a kiválasztott időszakban</td></tr>'
    }
  } catch {
    document.getElementById('usageTotals').innerHTML = '<div class="usage-stat"><div class="usage-stat-label">Nem sikerült betölteni</div></div>'
  }
}

document.getElementById('usageDaysSelect')?.addEventListener('change', loadUsageStats)

// ============================================================
// === Daily Log ===
// ============================================================

var dailyDates = []
var dailyCurrentDate = new Date().toISOString().split('T')[0]
var dailyAgentsLoaded = false

async function loadDailyAgents() {
  if (dailyAgentsLoaded) return
  try {
    const res = await fetch('/api/schedules/agents')
    const agents = await res.json()
    const sel = document.getElementById('dailyAgentSelect')
    sel.innerHTML = ''
    for (const a of agents) {
      const opt = document.createElement('option')
      opt.value = a.name
      opt.textContent = a.label || a.name
      sel.appendChild(opt)
    }
  } catch {}
  dailyAgentsLoaded = true
}

async function loadDailyDates() {
  const agent = document.getElementById('dailyAgentSelect').value || 'nova'
  try {
    const res = await fetch(`/api/daily-log/dates?agent=${encodeURIComponent(agent)}`)
    dailyDates = await res.json()
  } catch {
    dailyDates = []
  }
  renderDailyDateChips()
}

function renderDailyDateChips() {
  const container = document.getElementById('dailyDateChips')
  container.innerHTML = ''
  for (const d of dailyDates.slice(0, 14)) {
    const chip = document.createElement('button')
    chip.className = 'daily-date-chip' + (d === dailyCurrentDate ? ' active' : '')
    const dateObj = new Date(d + 'T12:00:00')
    const isToday = d === new Date().toISOString().split('T')[0]
    chip.textContent = isToday ? t('Ma') : dateObj.toLocaleDateString(currentLang === 'en' ? 'en-US' : 'hu-HU', { month: 'short', day: 'numeric' })
    chip.addEventListener('click', () => {
      dailyCurrentDate = d
      loadDailyContent()
      renderDailyDateChips()
    })
    container.appendChild(chip)
  }
}

function simpleMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => '<ul>' + m + '</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
}

async function loadDailyContent() {
  const agent = document.getElementById('dailyAgentSelect').value || 'nova'
  const contentEl = document.getElementById('dailyContent')
  const dateLabel = document.getElementById('dailyDateLabel')

  const dateObj = new Date(dailyCurrentDate + 'T12:00:00')
  const isToday = dailyCurrentDate === new Date().toISOString().split('T')[0]
  dateLabel.textContent = isToday ? t('Ma') : dateObj.toLocaleDateString(currentLang === 'en' ? 'en-US' : 'hu-HU', { year: 'numeric', month: 'long', day: 'numeric' })

  contentEl.innerHTML = '<div class="status-loading">Betöltés...</div>'

  try {
    const res = await fetch(`/api/daily-log?agent=${encodeURIComponent(agent)}&date=${dailyCurrentDate}`)
    const entries = await res.json()

    if (!entries || entries.length === 0) {
      contentEl.innerHTML = '<div class="daily-empty">Nincs bejegyzés ezen a napon</div>'
      return
    }

    contentEl.innerHTML = entries.map(entry => {
      return `<div class="daily-entry">${simpleMarkdown(entry.content)}</div>`
    }).join('')
  } catch {
    contentEl.innerHTML = '<div class="daily-empty">Nem sikerült betölteni</div>'
  }
}

async function loadDailyLog() {
  await loadDailyAgents()
  await loadDailyDates()
  if (dailyDates.length > 0 && !dailyDates.includes(dailyCurrentDate)) {
    dailyCurrentDate = dailyDates[0]
  }
  await loadDailyContent()
}

document.getElementById('dailyAgentSelect')?.addEventListener('change', () => {
  loadDailyDates()
  loadDailyContent()
})

document.getElementById('dailyPrevBtn')?.addEventListener('click', () => {
  const idx = dailyDates.indexOf(dailyCurrentDate)
  if (idx < dailyDates.length - 1) {
    dailyCurrentDate = dailyDates[idx + 1]
    loadDailyContent()
    renderDailyDateChips()
  }
})

document.getElementById('dailyNextBtn')?.addEventListener('click', () => {
  const idx = dailyDates.indexOf(dailyCurrentDate)
  if (idx > 0) {
    dailyCurrentDate = dailyDates[idx - 1]
    loadDailyContent()
    renderDailyDateChips()
  }
})

// ============================================================
// === Memory Import ===
// ============================================================

const memImportOverlay = document.getElementById('memImportOverlay')
const memImportFileInput = document.getElementById('memImportFile')
const memImportFileArea = document.getElementById('memImportFileArea')
const memImportFileNames = document.getElementById('memImportFileNames')
const memImportSaveBtn = document.getElementById('memImportSaveBtn')
const memImportProgress = document.getElementById('memImportProgress')
const memImportStatus = document.getElementById('memImportStatus')
const memImportResult = document.getElementById('memImportResult')
let memImportFiles = []

// Open import modal
document.getElementById('memImportOpenBtn').addEventListener('click', () => {
  memImportFiles = []
  memImportFileInput.value = ''
  memImportFileNames.textContent = ''
  memImportProgress.hidden = true
  memImportResult.hidden = true
  memImportSaveBtn.querySelector('.btn-text').hidden = false
  memImportSaveBtn.querySelector('.btn-loading').hidden = true
  memImportSaveBtn.disabled = false

  // Populate agent dropdown from existing agents
  const importAgentSel = document.getElementById('memImportAgent')
  const memAgentSel = document.getElementById('memAgent')
  importAgentSel.innerHTML = memAgentSel.innerHTML
  openModal(memImportOverlay)
})

// Close import modal
document.getElementById('memImportClose').addEventListener('click', () => closeModal(memImportOverlay))
memImportOverlay.addEventListener('click', (e) => { if (e.target === memImportOverlay) closeModal(memImportOverlay) })

// File area click -> trigger file input
memImportFileArea.addEventListener('click', () => memImportFileInput.click())

// Drag and drop
memImportFileArea.addEventListener('dragover', (e) => {
  e.preventDefault()
  memImportFileArea.style.borderColor = 'var(--accent)'
})
memImportFileArea.addEventListener('dragleave', () => {
  memImportFileArea.style.borderColor = ''
})
memImportFileArea.addEventListener('drop', (e) => {
  e.preventDefault()
  memImportFileArea.style.borderColor = ''
  const files = Array.from(e.dataTransfer.files).filter(f =>
    f.name.endsWith('.md') || f.name.endsWith('.txt') || f.name.endsWith('.json')
  )
  if (files.length) {
    memImportFiles = files
    memImportFileNames.textContent = files.map(f => f.name).join(', ')
  }
})

// File input change
memImportFileInput.addEventListener('change', () => {
  memImportFiles = Array.from(memImportFileInput.files)
  memImportFileNames.textContent = memImportFiles.map(f => f.name).join(', ')
})

// Parse file into chunks (client-side)
async function parseFileToChunks(file) {
  const text = await file.text()
  const ext = file.name.split('.').pop().toLowerCase()

  if (ext === 'json') {
    try {
      const data = JSON.parse(text)
      if (Array.isArray(data)) {
        return data.map(item => {
          if (typeof item === 'object' && item !== null) return item.content || item.text || item.value || JSON.stringify(item)
          return String(item)
        }).filter(s => s.length > 20).map(s => s.slice(0, 2000))
      }
      return Object.entries(data).map(([k, v]) => `${k}: ${v}`).filter(s => s.length > 20).map(s => s.slice(0, 2000))
    } catch { return [text.slice(0, 2000)] }
  }

  if (ext === 'md') {
    return text.split(/\n(?=##?\s)/).map(s => s.trim()).filter(s => s.length > 20).map(s => s.slice(0, 2000))
  }

  // txt: split by paragraphs
  return text.split(/\n\n+/).map(s => s.trim()).filter(s => s.length > 20).map(s => s.slice(0, 2000))
}

// Import button click
memImportSaveBtn.addEventListener('click', async () => {
  if (!memImportFiles.length) {
    showToast(t('Válassz legalább egy fájlt'))
    return
  }

  memImportSaveBtn.querySelector('.btn-text').hidden = true
  memImportSaveBtn.querySelector('.btn-loading').hidden = false
  memImportSaveBtn.disabled = true
  memImportProgress.hidden = false
  memImportResult.hidden = true
  memImportStatus.textContent = t('Fájlok feldolgozása...')

  try {
    // Parse all files into chunks
    let allChunks = []
    for (const file of memImportFiles) {
      const chunks = await parseFileToChunks(file)
      allChunks = allChunks.concat(chunks)
    }

    if (allChunks.length === 0) {
      memImportProgress.hidden = true
      memImportSaveBtn.querySelector('.btn-text').hidden = false
      memImportSaveBtn.querySelector('.btn-loading').hidden = true
      memImportSaveBtn.disabled = false
      showToast(t('Nincs importálható tartalom a fájlokban'))
      return
    }

    memImportStatus.textContent = `${allChunks.length} chunk kategorizálása és importálása...`

    const agentId = document.getElementById('memImportAgent').value || 'nova'
    const resp = await fetch('/api/memories/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, chunks: allChunks }),
    })
    const data = await resp.json()

    memImportProgress.hidden = true

    if (data.ok) {
      const s = data.stats || {}
      memImportResult.hidden = false
      memImportResult.innerHTML = `
        <div style="color:var(--text-primary);font-weight:600;margin-bottom:8px">Költöztetés kész!</div>
        <div style="font-size:13px;color:var(--text-secondary)">
          Összesen: <strong>${data.imported}</strong> emlék importálva<br>
          Hot: ${s.hot || 0} | Warm: ${s.warm || 0} | Cold: ${s.cold || 0} | Shared: ${s.shared || 0}
        </div>
      `
      showToast(`${data.imported} emlék importálva`)
      loadMemories()
      loadMemStats()
    } else {
      showToast('Hiba: ' + (data.error || 'Ismeretlen'), 3000, 'error')
    }
  } catch (err) {
    memImportProgress.hidden = true
    showToast(t('Hiba a költöztetés során'), 3000, 'error')
  }

  memImportSaveBtn.querySelector('.btn-text').hidden = false
  memImportSaveBtn.querySelector('.btn-loading').hidden = true
  memImportSaveBtn.disabled = false
})

// ============================================================
// === Költöztetés (Migration) ===
// ============================================================

let migrateFindings = []

async function loadMigrateAgents() {
  try {
    const res = await fetch('/api/schedules/agents')
    const agents = await res.json()
    const sel = document.getElementById('migrateAgent')
    sel.innerHTML = ''
    for (const a of agents) {
      const opt = document.createElement('option')
      opt.value = a.name
      opt.textContent = a.label || a.name
      sel.appendChild(opt)
    }
  } catch {}
}

// Step 1: Scan
document.getElementById('migrateScanBtn').addEventListener('click', async () => {
  const path = document.getElementById('migratePath').value.trim()
  const type = document.getElementById('migrateType').value
  if (!path) { document.getElementById('migratePath').focus(); return }

  const btn = document.getElementById('migrateScanBtn')
  btn.disabled = true
  btn.querySelector('.btn-text').hidden = true
  btn.querySelector('.btn-loading').hidden = false

  try {
    const res = await fetch('/api/migrate/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: path, sourceType: type }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Hiba')

    migrateFindings = data.findings
    renderMigrateFindings(data)

    document.getElementById('migrateStep1').hidden = true
    document.getElementById('migrateStep2').hidden = false
  } catch (err) {
    showToast(`Hiba: ${err.message}`, 3000, 'error')
  } finally {
    btn.disabled = false
    btn.querySelector('.btn-text').hidden = false
    btn.querySelector('.btn-loading').hidden = true
  }
})

function renderMigrateFindings(data) {
  const findingsEl = document.getElementById('migrateFindings')
  const summaryEl = document.getElementById('migrateSummary')

  const typeIcons = {
    'personality': '\uD83C\uDFAD',
    'profile': '\uD83D\uDC64',
    'memory': '\uD83E\uDDE0',
    'memory-hot': '\uD83D\uDD25',
    'memory-warm': '\uD83C\uDF21\uFE0F',
    'memory-cold': '\u2744\uFE0F',
    'heartbeat': '\uD83D\uDC93',
    'config': '\u2699\uFE0F',
    'daily-log': '\uD83D\uDCCB',
    'schedule': '\u23F0',
  }
  const typeLabels = {
    'personality': t('Személyiség'),
    'profile': t('Felhasználói profil'),
    'memory': t('Memória'),
    'memory-hot': t('Hot memória'),
    'memory-warm': t('Warm memória'),
    'memory-cold': t('Cold memória'),
    'heartbeat': t('Heartbeat konfig'),
    'config': t('Konfiguráció'),
    'daily-log': t('Napi napló'),
    'schedule': t('Ütemezés'),
  }

  findingsEl.innerHTML = ''
  for (const f of data.findings) {
    const div = document.createElement('div')
    div.className = 'migrate-finding'
    const sizeKB = Math.round(f.size / 1024 * 10) / 10
    div.innerHTML = `
      <span class="migrate-finding-icon">${typeIcons[f.type] || '\uD83D\uDCC4'}</span>
      <div class="migrate-finding-info">
        <div class="migrate-finding-name">${escapeHtml(f.name)}</div>
        <div class="migrate-finding-type">${escapeHtml(typeLabels[f.type] || f.type || '')}</div>
      </div>
      <span class="migrate-finding-size">${sizeKB} KB</span>
    `
    findingsEl.appendChild(div)
  }

  if (data.findings.length === 0) {
    findingsEl.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center">Nem található migrálható tartalom</div>'
  }

  const s = data.summary
  summaryEl.innerHTML = `
    <div class="stat-card"><div class="stat-value">${s.total}</div><div class="stat-label">Összesen</div></div>
    <div class="stat-card"><div class="stat-value">${s.memory}</div><div class="stat-label">Memória</div></div>
    <div class="stat-card"><div class="stat-value">${s.personality + s.profile}</div><div class="stat-label">Profil</div></div>
    <div class="stat-card"><div class="stat-value">${s.config + s.heartbeat}</div><div class="stat-label">Konfig</div></div>
  `
}

// Back button
document.getElementById('migrateBackBtn').addEventListener('click', () => {
  document.getElementById('migrateStep1').hidden = false
  document.getElementById('migrateStep2').hidden = true
})

// Step 2: Run migration
document.getElementById('migrateRunBtn').addEventListener('click', async () => {
  const agentId = document.getElementById('migrateAgent').value
  const btn = document.getElementById('migrateRunBtn')
  btn.disabled = true
  btn.querySelector('.btn-text').hidden = true
  btn.querySelector('.btn-loading').hidden = false

  try {
    const res = await fetch('/api/migrate/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ findings: migrateFindings, agentId }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Hiba')

    // Show results
    document.getElementById('migrateStep2').hidden = true
    document.getElementById('migrateStep3').hidden = false

    const resultEl = document.getElementById('migrateResult')
    resultEl.innerHTML = `
      <h4>Költöztetés kész!</h4>
      <div class="migrate-result-stats">
        <div class="migrate-result-stat"><div class="migrate-result-stat-value">${data.imported}</div><div class="migrate-result-stat-label">Importálva</div></div>
        <div class="migrate-result-stat"><div class="migrate-result-stat-value" style="color:#dc3c3c">${data.stats.hot}</div><div class="migrate-result-stat-label">Hot</div></div>
        <div class="migrate-result-stat"><div class="migrate-result-stat-value" style="color:#d97757">${data.stats.warm}</div><div class="migrate-result-stat-label">Warm</div></div>
        <div class="migrate-result-stat"><div class="migrate-result-stat-value" style="color:#6a9bcc">${data.stats.cold}</div><div class="migrate-result-stat-label">Cold</div></div>
        <div class="migrate-result-stat"><div class="migrate-result-stat-value" style="color:#9a8a30">${data.stats.shared}</div><div class="migrate-result-stat-label">Shared</div></div>
      </div>
      ${data.details ? '<div class="migrate-result-details">' + data.details.map(d => escapeHtml(d)).join('<br>') + '</div>' : ''}
    `
  } catch (err) {
    showToast(`Hiba: ${err.message}`, 3000, 'error')
  } finally {
    btn.disabled = false
    btn.querySelector('.btn-text').hidden = false
    btn.querySelector('.btn-loading').hidden = true
  }
})

// New migration
document.getElementById('migrateNewBtn').addEventListener('click', () => {
  document.getElementById('migrateStep1').hidden = false
  document.getElementById('migrateStep2').hidden = true
  document.getElementById('migrateStep3').hidden = true
})

// === Chat Widget ===
const chatFab = document.getElementById('chatFab')
const chatPanel = document.getElementById('chatPanel')
const chatClose = document.getElementById('chatClose')
const chatInput = document.getElementById('chatInput')
const chatSend = document.getElementById('chatSend')
const chatMessages = document.getElementById('chatMessages')
const chatAgentSelect = document.getElementById('chatAgentSelect')
const chatClear = document.getElementById('chatClear')

let chatSessionId = null
let chatHistoryLoaded = false

// Populate agent selector
async function loadChatAgents() {
  try {
    const res = await fetch('/api/schedules/agents')
    const agents = await res.json()
    chatAgentSelect.innerHTML = ''
    for (const a of agents) {
      const opt = document.createElement('option')
      opt.value = a.name
      opt.textContent = a.label || a.name
      chatAgentSelect.appendChild(opt)
    }
  } catch {}
}

// Load chat history from DB
async function loadChatHistory() {
  const agent = chatAgentSelect.value || 'nova'
  try {
    const res = await fetch(`/api/chat/history?agent=${encodeURIComponent(agent)}&limit=50`)
    const messages = await res.json()
    chatMessages.innerHTML = ''
    if (messages.length === 0) {
      chatMessages.innerHTML = `<div class="chat-info">${currentLang === 'en' ? `Chat with ${agent === 'nova' ? 'Nova' : agent}` : `Chat ${agent === 'nova' ? 'Nova' : agent}-val`}</div>`
    }
    for (const msg of messages) {
      const div = document.createElement('div')
      div.className = `chat-msg ${msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'agent'}`
      const time = new Date(msg.created_at * 1000).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
      div.setAttribute('data-time', time)
      div.textContent = msg.content
      chatMessages.appendChild(div)
    }
    chatMessages.scrollTo({ top: chatMessages.scrollHeight })
  } catch {}
}

chatFab.addEventListener('click', async () => {
  chatPanel.hidden = !chatPanel.hidden
  if (!chatPanel.hidden) {
    if (!chatHistoryLoaded) {
      await loadChatAgents()
      chatHistoryLoaded = true
    }
    await loadChatHistory()
    chatInput.focus()
  }
})
chatClose.addEventListener('click', () => { chatPanel.hidden = true })

chatAgentSelect.addEventListener('change', () => {
  chatSessionId = null
  loadChatHistory()
  const agent = chatAgentSelect.value || 'nova'
  chatInput.placeholder = currentLang === 'en' ? `Message to ${agent === 'nova' ? 'Nova' : agent}...` : `Üzenet ${agent === 'nova' ? 'Nova' : agent}-nak...`
})

chatClear.addEventListener('click', async () => {
  if (!confirm(t('Biztosan törlöd a chat előzményeket?'))) return
  const agent = chatAgentSelect.value || 'nova'
  try {
    await fetch(`/api/chat/history?agent=${encodeURIComponent(agent)}`, { method: 'DELETE' })
    chatMessages.innerHTML = `<div class="chat-info">${currentLang === 'en' ? `Chat with ${agent === 'nova' ? 'Nova' : agent}` : `Chat ${agent === 'nova' ? 'Nova' : agent}-val`}</div>`
    chatSessionId = null
  } catch {}
})

async function sendChatMessage() {
  const msg = chatInput.value.trim()
  if (!msg) return
  const agent = chatAgentSelect.value || 'nova'

  chatInput.disabled = true
  chatSend.disabled = true

  const time = new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  const userDiv = document.createElement('div')
  userDiv.className = 'chat-msg user'
  userDiv.setAttribute('data-time', time)
  userDiv.textContent = msg
  chatMessages.appendChild(userDiv)
  chatInput.value = ''
  chatInput.style.height = 'auto'

  const agentDiv = document.createElement('div')
  agentDiv.className = 'chat-msg agent chat-streaming'
  agentDiv.setAttribute('data-time', time)
  agentDiv.textContent = ''
  chatMessages.appendChild(agentDiv)

  // Show typing indicator
  const cursor = document.createElement('span')
  cursor.className = 'chat-cursor'
  agentDiv.appendChild(cursor)
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' })

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, sessionId: chatSessionId, agent })
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Hiba' }))
      agentDiv.remove()
      const errDiv = document.createElement('div')
      errDiv.className = 'chat-msg system'
      errDiv.textContent = err.error || 'Hiba történt'
      chatMessages.appendChild(errDiv)
    } else {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              if (eventType === 'text') {
                cursor.remove()
                agentDiv.textContent = data.text
                agentDiv.appendChild(cursor)
                chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' })
              } else if (eventType === 'done') {
                cursor.remove()
                agentDiv.classList.remove('chat-streaming')
                agentDiv.textContent = data.reply
                agentDiv.setAttribute('data-time', new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }))
                chatSessionId = data.sessionId || chatSessionId
              } else if (eventType === 'error') {
                cursor.remove()
                agentDiv.remove()
                const errDiv = document.createElement('div')
                errDiv.className = 'chat-msg system'
                errDiv.textContent = data.error
                chatMessages.appendChild(errDiv)
              }
            } catch {}
            eventType = ''
          }
        }
      }

      // Clean up cursor if still present
      cursor.remove()
      agentDiv.classList.remove('chat-streaming')
    }
  } catch {
    agentDiv.remove()
    const errDiv = document.createElement('div')
    errDiv.className = 'chat-msg system'
    errDiv.textContent = t('Kapcsolódási hiba')
    chatMessages.appendChild(errDiv)
  }

  chatInput.disabled = false
  chatSend.disabled = false
  chatInput.focus()
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' })
}

chatSend.addEventListener('click', sendChatMessage)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendChatMessage()
  }
})

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto'
  chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px'
})

// === Skills Page ===
var allSkills = []

function _getSkillCategoryMap() {
  return {
    'photography': 'Fotó', 'eskuvo-szerzodes': 'Fotó', 'selfiebox-szerzodes': 'Fotó', 'ajanlat-email': 'Fotó',
    'copywriting': 'Marketing', 'seo-advanced': 'Marketing', 'seo-content': 'Marketing',
    'social-media-engine': 'Marketing', 'market-research': 'Marketing', 'mailerlite': 'Marketing',
    'hirlevelek': 'Marketing', 'email-marketing': 'Marketing', 'leadek': 'Marketing',
    'landing-page-generator': 'Marketing', 'upload-post': 'Marketing',
    'pdf-generator': 'Dokumentum', 'excel-xlsx': 'Dokumentum', 'word-docx': 'Dokumentum',
    'nano-pdf': 'Dokumentum', 'imagemagick': 'Dokumentum',
    'billingo-szamla': 'Pénzügy', 'billingo-osszevetes': 'Pénzügy', 'uj-szamla': 'Pénzügy',
    'penzugyi-kivonat': 'Pénzügy', 'kulfoldi-forditott': 'Pénzügy',
    'naptar': 'Rendszer', 'calendar': 'Rendszer', 'email-monitoring': 'Rendszer',
    'gog': 'Rendszer', 'imap-smtp-email': 'Rendszer', 'drive-manager': 'Rendszer',
    'n8n-workflow-automation': 'Automatizáció', 'brave-search': 'Automatizáció', 'portainer': 'Automatizáció',
    'kanban': 'Rendszer', 'memoria': 'Rendszer', 'naplo': 'Rendszer', 'riport': 'Rendszer', 'statusz': 'Rendszer',
    'crm': 'CRM', 'ai-smart-crm': 'CRM',
    'vibe-design': 'Design', 'elementor-mcp-docs': 'Design',
    'gh-issues': 'Dev', 'find-skills': 'Dev', 'spreadsheet-engineering': 'Dev',
    'stripe-best-practices': 'Pénzügy', 'tech-news-digest': 'Automatizáció',
    'ingatlan-kereso': 'Egyéb', 'uzenet': 'Rendszer',
  }
}

function _getCategoryColors() {
  return {
    'Fotó': '#f59e0b', 'Marketing': '#10b981', 'Blog': '#8b5cf6', 'Dokumentum': '#6366f1',
    'Pénzügy': '#ef4444', 'Automatizáció': '#06b6d4', 'CRM': '#ec4899',
    'Design': '#f97316', 'Dev': '#84cc16', 'Egyéb': '#6b7280',
  }
}

async function loadSkillsPage() {
  _bindSkillModalEvents()
  const skillCategoryMap = _getSkillCategoryMap()
  const categoryColors = _getCategoryColors()
  const grid = document.getElementById('skillsGrid')
  grid.innerHTML = `<p>${t('Betöltés...')}</p>`
  try {
    const res = await fetch('/api/nova')
    if (!res.ok) { grid.innerHTML = `<p>API hiba: ${res.status}. Próbáld újratölteni az oldalt.</p>`; return }
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { grid.innerHTML = `<p>${t('Hibás API válasz')}</p>`; return }
    if (!data.skills) { grid.innerHTML = `<p>${t('Nincs skill adat')}</p>`; return }
    allSkills = (data.skills || []).map(s => ({
      ...s,
      category: skillCategoryMap[s.name] || 'Egyéb',
    }))

    // Stats
    const categories = {}
    allSkills.forEach(s => { categories[s.category] = (categories[s.category] || 0) + 1 })
    document.getElementById('skillsStats').innerHTML = `
      <span class="skills-stat-total">${allSkills.length} skill</span>
      <span class="skills-stat-cats">${Object.keys(categories).length} ${currentLang === 'en' ? 'categories' : 'kategória'}</span>
    `

    // Filters
    const filtersEl = document.getElementById('skillFilters')
    filtersEl.innerHTML = `<button class="skill-filter active" data-cat="all">${currentLang === 'en' ? 'All' : 'Mind'}</button>` +
      Object.entries(categories).sort((a,b) => b[1]-a[1]).map(([cat, count]) =>
        `<button class="skill-filter" data-cat="${cat}" style="--cat-color:${categoryColors[cat]||'#6b7280'}">${t(cat)} (${count})</button>`
      ).join('')

    filtersEl.querySelectorAll('.skill-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        filtersEl.querySelectorAll('.skill-filter').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        renderSkills(btn.dataset.cat)
      })
    })

    renderSkills('all')

    // Search
    document.getElementById('skillSearch')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase()
      const activeFilter = filtersEl.querySelector('.skill-filter.active')?.dataset.cat || 'all'
      renderSkills(activeFilter, q)
    })
  } catch (err) {
    console.error('Skills load error:', err)
    document.getElementById('skillsGrid').innerHTML = `<p>Hiba a skillek betöltése során: ${escapeHtml(String(err?.message || err || ''))}</p>`
  }
}

function renderSkills(category, search = '') {
  const categoryColors = _getCategoryColors()
  let filtered = allSkills
  if (category !== 'all') filtered = filtered.filter(s => s.category === category)
  if (search) filtered = filtered.filter(s =>
    s.name.toLowerCase().includes(search) || s.description.toLowerCase().includes(search)
  )

  const grid = document.getElementById('skillsGrid')
  if (filtered.length === 0) {
    grid.innerHTML = `<p class="no-results">${currentLang === 'en' ? 'No results' : 'Nincs találat'}</p>`
    return
  }

  grid.innerHTML = filtered.map(skill => `
    <div class="skill-card" data-skill="${escapeHtml(skill.name)}">
      <div class="skill-card-header">
        <span class="skill-card-cat" style="background:${categoryColors[skill.category]||'#6b7280'}">${t(skill.category)}</span>
      </div>
      <div class="skill-card-name">${escapeHtml(skill.name)}</div>
      <div class="skill-card-desc">${escapeHtml(skill.description)}</div>
    </div>
  `).join('')

  grid.querySelectorAll('.skill-card').forEach(card => {
    card.addEventListener('click', () => showSkillDetail(card.dataset.skill))
  })
}

async function showSkillDetail(skillName) {
  const categoryColors = _getCategoryColors()
  document.getElementById('skillDetailTitle').textContent = skillName
  const skill = allSkills.find(s => s.name === skillName)
  const cat = skill?.category || 'Egyéb'
  document.getElementById('skillDetailMeta').innerHTML = `
    <span class="skill-card-cat" style="background:${categoryColors[cat]||'#6b7280'}">${cat}</span>
    <span class="skill-detail-desc">${escapeHtml(skill?.description || '')}</span>
  `
  document.getElementById('skillDetailContent').textContent = t('Betöltés...')
  openModal(document.getElementById('skillsPageDetailOverlay'))

  // Target agent lista feltöltés (kivéve nova, mert az a source)
  try {
    const agRes = await fetch('/api/agents')
    const agData = await agRes.json()
    const agents = Array.isArray(agData) ? agData : (agData.agents || [])
    const targetSelect = document.getElementById('skillCopyTarget')
    if (targetSelect) {
      targetSelect.innerHTML = '<option value="">' + t('Válassz cél agent-et…') + '</option>'
      agents.forEach(a => {
        const n = a.name || a.id
        if (n && n !== 'nova') {
          const opt = document.createElement('option')
          opt.value = n
          opt.textContent = n
          targetSelect.appendChild(opt)
        }
      })
      targetSelect.dataset.sourceAgent = 'nova'
      targetSelect.dataset.skillName = skillName
    }
    // Status reset
    const statusEl = document.getElementById('skillCopyStatus')
    if (statusEl) statusEl.textContent = ''
  } catch (e) {
    console.warn('Agent lista betöltés sikertelen', e)
  }

  try {
    const res = await fetch(`/api/nova/skills/${encodeURIComponent(skillName)}`)
    const data = await res.json()
    document.getElementById('skillDetailContent').textContent = data.content || '(üres)'
  } catch {
    document.getElementById('skillDetailContent').textContent = t('Hiba a betöltés során')
  }
}

// Skill copy gomb — irányított másolás
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'skillCopyBtn') {
    const select = document.getElementById('skillCopyTarget')
    const statusEl = document.getElementById('skillCopyStatus')
    const target = select?.value
    const source = select?.dataset.sourceAgent || 'nova'
    const skill = select?.dataset.skillName
    if (!target || !skill) {
      if (statusEl) statusEl.textContent = t('Válassz cél agent-et')
      return
    }
    if (!confirm(t('Biztos másolod a skillt "') + skill + t('" → ') + target + '?')) return
    if (statusEl) statusEl.textContent = t('Másolás folyamatban…')
    try {
      const res = await fetch('/api/skills/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_agent: source, target_agent: target, skill_name: skill }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        if (statusEl) statusEl.textContent = '✅ ' + t('Másolva: ') + target + '/' + skill
      } else {
        if (statusEl) statusEl.textContent = '❌ ' + (data.error || t('Hiba'))
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = '❌ ' + t('Hálózati hiba')
    }
  }
})

// New skill modal — lazy bind (hoisting-safe)
function _bindSkillModalEvents() {
  if (window.__skillModalBound) return
  window.__skillModalBound = true

  document.getElementById('newSkillBtn')?.addEventListener('click', () => {
    document.getElementById('newSkillName').value = ''
    document.getElementById('newSkillDesc').value = ''
    openModal(document.getElementById('newSkillOverlay'))
    setTimeout(() => document.getElementById('newSkillName').focus(), 200)
  })
  document.getElementById('newSkillClose')?.addEventListener('click', () => {
    closeModal(document.getElementById('newSkillOverlay'))
  })
  document.getElementById('newSkillOverlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal(document.getElementById('newSkillOverlay'))
  })
  // skillsPageDetailOverlay (Skillek tab modal) close handler
  document.getElementById('skillDetailClose')?.addEventListener('click', () => {
    closeModal(document.getElementById('skillsPageDetailOverlay'))
  })
  document.getElementById('skillsPageDetailOverlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal(document.getElementById('skillsPageDetailOverlay'))
  })
  // agentSkillDetailOverlay backdrop close
  document.getElementById('agentSkillDetailOverlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal(document.getElementById('agentSkillDetailOverlay'))
  })
  document.getElementById('generateSkillBtn')?.addEventListener('click', async () => {
  const name = document.getElementById('newSkillName').value.trim()
  const description = document.getElementById('newSkillDesc').value.trim()
  if (!name || !description) { showToast(t('Név és leírás kötelező')); return }

  const btn = document.getElementById('generateSkillBtn')
  btn.querySelector('.btn-text').hidden = true
  btn.querySelector('.btn-loading').hidden = false
  btn.disabled = true

  try {
    const res = await fetch('/api/nova/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    })
    const data = await res.json()
    if (res.ok) {
      closeModal(document.getElementById('newSkillOverlay'))
      showToast(`Skill "${data.name}" létrehozva!`)
      loadSkillsPage()
    } else {
      showToast(data.error || 'Hiba történt')
    }
  } catch (err) {
    showToast(t('Hiba a skill generálása során'), 3000, 'error')
  } finally {
    btn.querySelector('.btn-text').hidden = false
    btn.querySelector('.btn-loading').hidden = true
    btn.disabled = false
  }
  })
} // end _bindSkillModalEvents

// === MCP Catalog ===
const MCP_CATALOG = [
  { name: 'brave-search', label: 'Brave Search', desc: 'Web keresés a Brave Search API-val', cat: 'search', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-brave-search'], env: { BRAVE_API_KEY: '' } },
  { name: 'github', label: 'GitHub', desc: 'Repository kezelés, PR-ek, issue-k', cat: 'development', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-github'], env: { GITHUB_TOKEN: '' } },
  { name: 'playwright', label: 'Playwright', desc: 'Böngésző automatizálás, screenshot, scraping', cat: 'development', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-playwright'] },
  { name: 'filesystem', label: 'Filesystem', desc: 'Fájlrendszer olvasás/írás sandbox-ban', cat: 'system', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-filesystem', '/tmp'] },
  { name: 'postgres', label: 'PostgreSQL', desc: 'Adatbázis lekérdezés és kezelés', cat: 'development', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { DATABASE_URL: '' } },
  { name: 'sqlite', label: 'SQLite', desc: 'SQLite adatbázis kezelés', cat: 'development', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-sqlite'] },
  { name: 'context7', label: 'Context7', desc: 'Friss framework dokumentáció betöltés', cat: 'development', command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'] },
  { name: 'sentry', label: 'Sentry', desc: 'Error tracking és production debugging', cat: 'development', command: 'npx', args: ['-y', '@sentry/mcp-server'], env: { SENTRY_AUTH_TOKEN: '' } },
  { name: 'slack', label: 'Slack', desc: 'Slack üzenetek küldése/olvasása', cat: 'communication', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-slack'], env: { SLACK_TOKEN: '' } },
  { name: 'notion', label: 'Notion', desc: 'Notion oldalak és adatbázisok kezelése', cat: 'productivity', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-notion'], env: { NOTION_API_KEY: '' } },
  { name: 'google-drive', label: 'Google Drive', desc: 'Fájlok kezelése Google Drive-ban', cat: 'productivity', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-google-drive'] },
  { name: 'google-maps', label: 'Google Maps', desc: 'Térkép, geocoding, útvonaltervezés', cat: 'search', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-google-maps'], env: { GOOGLE_MAPS_API_KEY: '' } },
  { name: 'elevenlabs', label: 'ElevenLabs', desc: 'TTS, voice cloning, hangeffektek', cat: 'ai', command: 'npx', args: ['-y', 'elevenlabs-mcp'], env: { ELEVENLABS_API_KEY: '' } },
  { name: 'fal-ai', label: 'Fal.ai', desc: 'Kép/videó/hang generálás (FLUX, Sora, stb.)', cat: 'ai', command: 'npx', args: ['-y', 'fal-ai-mcp-server'], env: { FAL_KEY: '' } },
  { name: 'billingo', label: 'Billingo', desc: 'Magyar számlázás (számla, partner, kiadás)', cat: 'finance', command: 'node', args: ['/srv/billingo-mcp/dist/cli.js'], env: { BILLINGO_API_KEY: '' } },
  { name: 'memory', label: 'MCP Memory', desc: 'Szemantikus memória szerver', cat: 'ai', command: 'npx', args: ['-y', 'mcp-remote'], env: {} },
  { name: 'fetch', label: 'Fetch', desc: 'HTTP kérések küldése bármilyen URL-re', cat: 'search', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-fetch'] },
  { name: 'puppeteer', label: 'Puppeteer', desc: 'Headless Chrome böngésző vezérlés', cat: 'development', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-puppeteer'] },

  // === Új: Keresés ===
  { name: 'exa', label: 'Exa', desc: 'AI-natív web keresés szemantikus és kulcsszavas módban', cat: 'search', command: 'npx', args: ['-y', 'exa-mcp-server'], env: { EXA_API_KEY: '' } },
  { name: 'tavily', label: 'Tavily', desc: 'AI-optimalizált keresés, összefoglalás, extract', cat: 'search', command: 'npx', args: ['-y', 'tavily-mcp-server'], env: { TAVILY_API_KEY: '' } },
  { name: 'firecrawl', label: 'Firecrawl', desc: 'Web scraping, crawling, site-map kinyerés', cat: 'search', command: 'npx', args: ['-y', 'firecrawl-mcp'], env: { FIRECRAWL_API_KEY: '' } },

  // === Új: Fejlesztés ===
  { name: 'gitlab', label: 'GitLab', desc: 'GitLab repo, MR, pipeline, issue kezelés', cat: 'development', command: 'npx', args: ['-y', '@modelcontextprotocol/server-gitlab'], env: { GITLAB_TOKEN: '', GITLAB_URL: 'https://gitlab.com' } },
  { name: 'mysql', label: 'MySQL', desc: 'MySQL/MariaDB adatbázis lekérdezés', cat: 'development', command: 'npx', args: ['-y', '@benborla29/mcp-server-mysql'], env: { MYSQL_HOST: 'localhost', MYSQL_USER: '', MYSQL_PASS: '', MYSQL_DB: '' } },
  { name: 'redis', label: 'Redis', desc: 'Redis kulcs-érték tár kezelés', cat: 'development', command: 'npx', args: ['-y', '@modelcontextprotocol/server-redis'], env: { REDIS_URL: 'redis://localhost:6379' } },
  { name: 'docker', label: 'Docker', desc: 'Container-ek listázása, indítása, leállítása, logok', cat: 'development', command: 'npx', args: ['-y', 'mcp-docker'] },
  { name: 'kubernetes', label: 'Kubernetes', desc: 'K8s pod, service, deployment kezelés', cat: 'development', command: 'npx', args: ['-y', 'mcp-kubernetes'] },
  { name: 'grafana', label: 'Grafana', desc: 'Dashboard-ok, metrikák, alertek lekérdezése', cat: 'development', command: 'npx', args: ['-y', 'mcp-grafana'], env: { GRAFANA_URL: '', GRAFANA_API_KEY: '' } },
  { name: 'cloudflare', label: 'Cloudflare', desc: 'Workers, DNS, KV, R2, D1 kezelés', cat: 'development', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-cloudflare'], env: { CLOUDFLARE_API_TOKEN: '' } },
  { name: 'vercel', label: 'Vercel', desc: 'Deploy-ok, projektek, domain-ek kezelése', cat: 'development', command: 'npx', args: ['-y', 'vercel-mcp-server'], env: { VERCEL_TOKEN: '' } },
  { name: 'supabase', label: 'Supabase', desc: 'Supabase DB, Auth, Storage, Edge Functions', cat: 'development', command: 'npx', args: ['-y', 'supabase-mcp-server'], env: { SUPABASE_URL: '', SUPABASE_KEY: '' } },
  { name: 'neon', label: 'Neon', desc: 'Neon serverless PostgreSQL kezelés', cat: 'development', command: 'npx', args: ['-y', '@anthropic-ai/mcp-server-neon'], env: { NEON_API_KEY: '' } },

  // === Új: Kommunikáció ===
  { name: 'discord', label: 'Discord', desc: 'Discord szerver üzenetek, csatornák kezelése', cat: 'communication', command: 'npx', args: ['-y', 'mcp-discord'], env: { DISCORD_TOKEN: '' } },
  { name: 'telegram-bot', label: 'Telegram Bot', desc: 'Telegram bot üzenetek küldése/fogadása', cat: 'communication', command: 'npx', args: ['-y', 'mcp-telegram'], env: { TELEGRAM_BOT_TOKEN: '' } },
  { name: 'email-smtp', label: 'Email (SMTP)', desc: 'Email küldés SMTP-n keresztül', cat: 'communication', command: 'npx', args: ['-y', 'mcp-email'], env: { SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' } },
  { name: 'twilio', label: 'Twilio', desc: 'SMS és telefonhívás küldés/fogadás', cat: 'communication', command: 'npx', args: ['-y', 'mcp-twilio'], env: { TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '' } },

  // === Új: Produktivitás ===
  { name: 'google-sheets', label: 'Google Sheets', desc: 'Táblázatok olvasása/írása Google Sheets-ben', cat: 'productivity', command: 'npx', args: ['-y', 'mcp-google-sheets'], env: { GOOGLE_SERVICE_ACCOUNT_KEY: '' } },
  { name: 'google-calendar', label: 'Google Calendar', desc: 'Naptár események kezelése', cat: 'productivity', command: 'npx', args: ['-y', 'mcp-google-calendar'], env: { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' } },
  { name: 'linear', label: 'Linear', desc: 'Issue tracking, projekt menedzsment', cat: 'productivity', command: 'npx', args: ['-y', 'mcp-linear'], env: { LINEAR_API_KEY: '' } },
  { name: 'todoist', label: 'Todoist', desc: 'Feladatkezelés, projektek, label-ek', cat: 'productivity', command: 'npx', args: ['-y', 'mcp-todoist'], env: { TODOIST_API_TOKEN: '' } },
  { name: 'airtable', label: 'Airtable', desc: 'Airtable base-ek, táblák, rekordok kezelése', cat: 'productivity', command: 'npx', args: ['-y', 'mcp-airtable'], env: { AIRTABLE_API_KEY: '' } },
  { name: 'trello', label: 'Trello', desc: 'Trello board-ok, kártyák, listák kezelése', cat: 'productivity', command: 'npx', args: ['-y', 'mcp-trello'], env: { TRELLO_API_KEY: '', TRELLO_TOKEN: '' } },
  { name: 'jira', label: 'Jira', desc: 'Jira issue-k, projektek, sprint-ek kezelése', cat: 'productivity', command: 'npx', args: ['-y', 'mcp-jira'], env: { JIRA_URL: '', JIRA_EMAIL: '', JIRA_API_TOKEN: '' } },
  { name: 'asana', label: 'Asana', desc: 'Asana feladatok, projektek, csapatok', cat: 'productivity', command: 'npx', args: ['-y', 'mcp-asana'], env: { ASANA_ACCESS_TOKEN: '' } },
  { name: 'confluence', label: 'Confluence', desc: 'Confluence wiki oldalak, space-ek kezelése', cat: 'productivity', command: 'npx', args: ['-y', 'mcp-confluence'], env: { CONFLUENCE_URL: '', CONFLUENCE_EMAIL: '', CONFLUENCE_API_TOKEN: '' } },

  // === Új: AI ===
  { name: 'openai', label: 'OpenAI', desc: 'GPT modellek, DALL-E, Whisper elérése', cat: 'ai', command: 'npx', args: ['-y', 'mcp-openai'], env: { OPENAI_API_KEY: '' } },
  { name: 'replicate', label: 'Replicate', desc: 'Open-source AI modellek futtatása (SD, LLaMA, stb.)', cat: 'ai', command: 'npx', args: ['-y', 'mcp-replicate'], env: { REPLICATE_API_TOKEN: '' } },
  { name: 'stability', label: 'Stability AI', desc: 'Stable Diffusion képgenerálás', cat: 'ai', command: 'npx', args: ['-y', 'mcp-stability'], env: { STABILITY_API_KEY: '' } },
  { name: 'huggingface', label: 'Hugging Face', desc: 'ML modellek, dataset-ek, Inference API', cat: 'ai', command: 'npx', args: ['-y', 'mcp-huggingface'], env: { HF_TOKEN: '' } },
  { name: 'langchain', label: 'LangChain', desc: 'RAG, chain-ek, agent-ek, vektortárak', cat: 'ai', command: 'npx', args: ['-y', 'mcp-langchain'], env: {} },

  // === Új: Pénzügy ===
  { name: 'stripe', label: 'Stripe', desc: 'Fizetések, előfizetések, számlák, refund-ok', cat: 'finance', command: 'npx', args: ['-y', '@stripe/mcp-server'], env: { STRIPE_SECRET_KEY: '' } },
  { name: 'wise', label: 'Wise', desc: 'Nemzetközi átutalások, árfolyamok', cat: 'finance', command: 'npx', args: ['-y', 'mcp-wise'], env: { WISE_API_KEY: '' } },
  { name: 'quickbooks', label: 'QuickBooks', desc: 'Könyvelés, számla, kiadás, riportok', cat: 'finance', command: 'npx', args: ['-y', 'mcp-quickbooks'], env: { QB_CLIENT_ID: '', QB_CLIENT_SECRET: '' } },

  // === Új: Rendszer ===
  { name: 'shell', label: 'Shell', desc: 'Shell parancsok futtatása sandbox-ban', cat: 'system', command: 'npx', args: ['-y', 'mcp-shell'] },
  { name: 'ssh', label: 'SSH', desc: 'Távoli szerver elérés SSH-n keresztül', cat: 'system', command: 'npx', args: ['-y', 'mcp-ssh'], env: { SSH_HOST: '', SSH_USER: '', SSH_KEY_PATH: '' } },
  { name: 'aws', label: 'AWS', desc: 'S3, EC2, Lambda, CloudWatch, RDS kezelés', cat: 'system', command: 'npx', args: ['-y', 'mcp-aws'], env: { AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', AWS_REGION: 'eu-central-1' } },
  { name: 'digitalocean', label: 'DigitalOcean', desc: 'Droplet-ek, volume-ok, DNS, App Platform', cat: 'system', command: 'npx', args: ['-y', 'mcp-digitalocean'], env: { DO_API_TOKEN: '' } },
]

function loadCatalog(filter = 'all') {
  const grid = document.getElementById('catalogGrid')
  if (!grid) return
  grid.innerHTML = ''
  const installed = connectors.map(c => c.name)
  const filtered = filter === 'all' ? MCP_CATALOG : MCP_CATALOG.filter(m => m.cat === filter)

  for (const mcp of filtered) {
    const isInstalled = installed.some(n => n.includes(mcp.name))
    const card = document.createElement('div')
    card.className = 'catalog-card' + (isInstalled ? ' installed' : '')
    card.innerHTML = `
      <div class="catalog-card-header">
        <span class="catalog-card-name">${escapeHtml(mcp.label)}</span>
        <span class="catalog-card-cat">${escapeHtml(mcp.cat)}</span>
      </div>
      <div class="catalog-card-desc">${escapeHtml(mcp.desc)}</div>
      <button class="btn-compact ${isInstalled ? 'btn-secondary' : 'btn-primary'}"
        ${isInstalled ? 'disabled' : ''}
        onclick="openCatalogInstall('${mcp.name}')">
        ${isInstalled ? '\u2713 ' + t('Telepítve') : t('Telepítés')}
      </button>
    `
    grid.appendChild(card)
  }
}

function openCatalogInstall(name) {
  const mcp = MCP_CATALOG.find(m => m.name === name)
  if (!mcp) return
  const body = document.getElementById('catalogInstallBody')
  const envFields = mcp.env ? Object.keys(mcp.env).map(k =>
    `<div class="form-group"><label>${k}</label><input type="text" id="catalog-env-${k}" placeholder="${k} értéke"></div>`
  ).join('') : ''

  body.innerHTML = `
    <p><strong>${mcp.label}</strong> — ${mcp.desc}</p>
    <div style="margin:16px 0;padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);font-family:monospace;font-size:12px">
      ${mcp.command} ${mcp.args.join(' ')}
    </div>
    ${envFields}
    <button class="btn-primary" onclick="installCatalogMcp('${mcp.name}')">
      <span class="btn-text">Telepítés</span>
      <span class="btn-loading" hidden><span class="spinner"></span> Telepítés...</span>
    </button>
  `
  document.getElementById('catalogInstallTitle').textContent = mcp.label + ' telepítés'
  openModal(document.getElementById('catalogInstallOverlay'))
}

async function installCatalogMcp(name) {
  const mcp = MCP_CATALOG.find(m => m.name === name)
  if (!mcp) return

  const config = { command: mcp.command, args: [...mcp.args] }
  if (mcp.env) {
    config.env = {}
    for (const k of Object.keys(mcp.env)) {
      const input = document.getElementById('catalog-env-' + k)
      if (input && input.value) config.env[k] = input.value
    }
  }

  try {
    const res = await fetch('/api/connectors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: mcp.name, type: 'local', command: config.command, args: config.args.join(' '), env: config.env, scope: 'project' })
    })
    if (res.ok) {
      showToast(mcp.label + ' telepítve!')
      closeModal(document.getElementById('catalogInstallOverlay'))
      loadConnectors()
      loadCatalog()
    } else {
      showToast(t('Hiba a telepítés során'), 3000, 'error')
    }
  } catch (e) { showToast(t('Hiba a telepítés során'), 3000, 'error') }
}

// Catalog tab switching
document.querySelector('.connector-tabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.connector-tab')
  if (!btn) return
  document.querySelectorAll('.connector-tab').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  const tab = btn.dataset.ctab
  document.getElementById('connectorInstalledTab').hidden = tab !== 'installed'
  document.getElementById('connectorCatalogTab').hidden = tab !== 'catalog'
  if (tab === 'catalog') loadCatalog()
})

document.getElementById('catalogFilters')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.catalog-filter-btn')
  if (!btn) return
  document.querySelectorAll('.catalog-filter-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  loadCatalog(btn.dataset.cat)
})

document.getElementById('catalogInstallClose')?.addEventListener('click', () => closeModal(document.getElementById('catalogInstallOverlay')))

// === Language toggle listener ===
document.getElementById('langToggle')?.addEventListener('click', switchLanguage)
// Apply saved language on load
if (currentLang === 'en') {
  const langBtn = document.getElementById('langToggle')
  if (langBtn) langBtn.textContent = 'HU'
  setTimeout(applyTranslations, 100)
}

// === Init ===
populateAvatarGrid()
loadMemAgents()
loadKanban()


// === Heartbeat hide toggle (schedules tab) ===
;(function () {
  const btn = document.getElementById("hideHeartbeatsBtn")
  if (!btn) return
  function syncBtn() {
    btn.setAttribute("aria-pressed", hideHeartbeats ? "true" : "false")
    const label = btn.querySelector(".hb-state")
    if (label) label.textContent = hideHeartbeats ? "ki" : "be"
  }
  syncBtn()
  btn.addEventListener("click", () => {
    hideHeartbeats = !hideHeartbeats
    try { localStorage.setItem("cc-hide-heartbeats", hideHeartbeats ? "1" : "0") } catch {}
    syncBtn()
    // Re-render whatever schedule view is active
    if (typeof loadSchedules === "function") loadSchedules()
  })
})()


// === Memory filter wiring ===
;(function () {
  const range = document.getElementById('memDateRange')
  const sort = document.getElementById('memSortBy')
  if (range) range.addEventListener('change', () => loadMemories())
  if (sort) sort.addEventListener('change', () => loadMemories())
})()


// === Mood legend toggle ===
;(function () {
  const btn = document.getElementById('moodInfoBtn')
  const legend = document.getElementById('moodLegend')
  if (!btn || !legend) return
  btn.addEventListener('click', () => {
    legend.hidden = !legend.hidden
  })
})()


// === Publikus release státusz ===
// Megmutatja az utolsó publikus release-t + hány privát commit vár
// még anonimizálásra. NEM "pull-olandó update"-et mutat, mert a privát
// és publikus branch DIVERGÁL (más history-val).
async function loadUpdates() {
  const summary = document.getElementById('updatesSummary')
  const commits = document.getElementById('updatesCommits')
  if (!summary || !commits) return
  summary.textContent = 'Lekerés…'
  commits.innerHTML = ''
  try {
    const res = await fetch('/api/updates/status')
    const data = await res.json()
    if (data.error) {
      summary.innerHTML = `<span style="color:var(--danger)">Hiba: ${escapeHtml(data.error)}</span> (branch: ${escapeHtml(data.currentBranch || '?')})`
      return
    }
    const pending = Number(data.pendingCommits ?? data.ahead ?? 0)
    const parts = []
    parts.push(`Privát HEAD: <code>${escapeHtml(data.currentHead || '?')}</code>`)
    if (data.lastRelease && data.lastRelease.hash) {
      const relDate = (data.lastRelease.date || '').slice(0, 10)
      parts.push(`Utolsó publikus release: <code>${escapeHtml(data.lastRelease.hash)}</code> <span class="muted">(${escapeHtml(relDate)})</span>`)
    }
    if (pending > 0) {
      parts.push(`<b style="color:var(--warning)">${pending} privát commit vár anonimizálásra</b>`)
    } else {
      parts.push('<span style="color:var(--success,#10b981)">Publikus release naprakész ✓</span>')
    }
    if (data.lastCheck) parts.push(`<span class="muted">utolsó ellenőrzés: ${new Date(data.lastCheck).toLocaleTimeString('hu-HU')}</span>`)
    summary.innerHTML = parts.join(' · ')
    const list = data.pendingList ?? data.commits ?? []
    if (Array.isArray(list) && list.length) {
      const rows = list.map(c => `
        <div class="commit-row">
          <code>${escapeHtml(c.hash || '')}</code>
          <span class="commit-subject">${escapeHtml(c.subject || '')}</span>
          <span class="commit-author muted">${escapeHtml(c.author || '')}</span>
          <span class="commit-date muted">${escapeHtml((c.date || '').slice(0, 10))}</span>
        </div>`).join('')
      commits.innerHTML = `<h3>Anonimizálásra váró privát commit-ok (legutóbbi ${list.length})</h3>${rows}`
    }
  } catch (err) {
    summary.innerHTML = `<span style="color:var(--danger)">Hiba: ${escapeHtml(String(err.message || err))}</span>`
  }
}

async function updateUpdatesBadge() {
  const badge = document.getElementById('updatesBadge')
  if (!badge) return
  try {
    const res = await fetch('/api/updates/status')
    const data = await res.json()
    const pending = Number(data && (data.pendingCommits ?? data.ahead) || 0)
    // Csak akkor jelzünk, ha SOK (>20) privát commit halmozódott fel
    // anonimizálásra — kisebb szám esetén nem érdemes badge-et villogtatni.
    if (pending > 20) {
      badge.hidden = false
      badge.textContent = String(pending)
      badge.title = `${pending} privát commit vár anonimizálásra`
    } else {
      badge.hidden = true
    }
  } catch { /* offline vagy hiba — ne zavarjuk a user-t */ }
}

document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refreshUpdatesBtn')
  if (refreshBtn) refreshBtn.addEventListener('click', loadUpdates)
})

// Első badge check 5 sec után, utána 5 percenként
setTimeout(updateUpdatesBadge, 5000)
setInterval(updateUpdatesBadge, 5 * 60 * 1000)
