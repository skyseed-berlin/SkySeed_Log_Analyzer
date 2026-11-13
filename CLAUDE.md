# Skyseed Log Analyzer: Projektdokumentation für Claude

## Projekt-Konfiguration
- **Git-Workflow:** vereinfacht        <!-- vollständig | vereinfacht -->
- **Doku-Sprache:** Deutsch            <!-- Deutsch | Englisch -->
- **GitHub:** https://github.com/skyseed-berlin/SkySeed_Log_Analyzer
- **Browsertests durch Claude:** ja     <!-- ja | nein -->
- **Skyseed-Design-Skill:** ja           <!-- ja | nein -->

## Was ist das Projekt?

Browser-App zur Auswertung von Saatflug-Logs auf einer Karte. Beliebig viele Logs werden per
Drag & Drop auf die Karte (oder über „Logs hinzufügen") geladen, je Log farbig als Saat- und
Transferlinien gezeichnet und statistisch ausgewertet: je Log und aggregiert über alle sichtbaren
Logs (Flugzeit, Saatzeit, Strecken, Saatfläche ohne Überschneidungen, abgeworfenes Gewicht,
RPM, Radar-Minima usw.). Die frühere Planung (.plan, RPM-Empfehlung) und die Saatgut-Datenbank
sind entfernt; der Analyzer wertet nur noch Logs aus.

## Architektur-Constraints

- **Kein Build-Tool, kein Server nötig.** `index.html` läuft direkt per `file://`. Alle Skripte
  sind klassische `<script src>`-Tags im globalen Scope, keine ES-Module.
- **Leaflet** kommt per CDN (unpkg, mit SRI-Hash). Ebenso supabase-js (jsDelivr, Version fest, SRI-Hash) für die Cloud-Logs. Weitere Abhängigkeiten nur nach Rückfrage.
- **Anmeldung:** Submodul `vendor/skyseed-auth` (privates Repo), `SkyseedAuth.guard()` mit Client-ID `skyseed-log-analyzer`, `env: 'prod'`, Gast-Modus erlaubt und Session-Bridge (`skyseed-session` in "Skyseed Apps"). Die Bridge ist nötig, weil `app_companion.flights` und der Bucket per RLS auf `authenticated` beschränkt sind. Gast-Modus: lokale Logs funktionieren wie vorher, nur die Cloud-Logs fordern die Anmeldung an.
- **Kartenkacheln:** Esri (Satellit und Straße), ohne Key und ohne Referer. CARTO verlangt seit
  Ende August 2026 einen API-Key, `tile.openstreetmap.org` blockiert `file://`. Beides nicht als
  Standard einsetzen.
- **Ladereihenfolge:** `leaflet.js` → supabase-js → `vendor/skyseed-auth/web/skyseed-auth.js` →
  `js/log-parser.js` → `js/log-stats.js` → `js/cloud-data.js` → `js/cloud-ui.js` → Inline-Skript in
  `index.html`.
- **GitHub Pages (später):** `vendor/skyseed-auth` ist privat. Der Pages-Workflow braucht einen
  read-only Deploy Key und einen Whitelist-Build (nur `web/` des Submoduls ausliefern, nie `path: '.'`),
  siehe Skill `skyseed-auth`, Datei `SKYSEED-AUTH_EINBINDUNG-WEB.md`, Abschnitt 5.
- **Öffentliches Repo:** Echte Flug-Logs (`*.jsonl`, `test-logs/`) sind per `.gitignore`
  ausgeschlossen, weil sie GPS-Positionen enthalten. Keine Logs committen.

## Dateistruktur

```
index.html           Markup und App-Logik (Karte, Log-Liste, KPI, Statistik-Tabelle,
                     Drag & Drop)
js/log-parser.js     Formaterkennung und Normalisierung (LogParser.parse)
js/log-stats.js      Statistik je Log, Saatflächen-Raster, Aggregation (LogStats.*)
js/cloud-data.js     Cloud-Zugriff: Flugliste und Rohdateien aus Supabase (Schema app_companion,
                     Bucket companion-flightlogs), Blöcke aus dem Dashboard (Seeddrops mit geojson),
                     Geometrie, Zuordnung, Filter. Ohne DOM, per Node testbar
js/cloud-ui.js       Seitenleisten-Bereich "Cloud-Logs": Suche, Filter, Fläche/Block, Mehrfachauswahl
tests/               node --test tests/cloud-data.test.js (Geometrie, Zuordnung, Filter)
vendor/skyseed-auth  Submodul, Login-Gate und Session-Bridge
styles/base.css      bindet die Skyseed-Design-Tokens ein
styles/tokens/*.css  vendorte Tokens aus dem Skill skyseed-design (nicht von Hand ändern,
                     bei Bedarf über den Skill neu synchronisieren)
styles/app.css       App-Stile auf Basis der Tokens
test-logs/           lokale Test-Logs, nicht im Repo
```

## Log-Formate

`LogParser.parse(text)` erkennt das Format am Inhalt und liefert `{meta, samples}` mit einem
einheitlichen Sample-Format (Felder siehe Kopfkommentar in `js/log-parser.js`).

- **Companion-Log** (`flight_*.jsonl`, copter-companion 4.x): eine JSON-Zeile pro Sample, dazu
  Ereigniszeilen `flight_start` / `flight_end`. `ts` hat nur Sekundenauflösung,
  `spreadSampleTimes()` verteilt Samples mit gleichem Zeitstempel über höchstens 1 s.
  - **Saat:** `seeder.target_rpm > 0`. `meas_rpm` hält nach dem Abschalten den letzten Wert und
    taugt deshalb nicht als Schalter.
  - **Leerer Behälter:** `seeder.empty === "empty"`; solche Abschnitte zählen als eigene Kategorie
    und nicht zur Saatfläche.
  - **Radar:** `*_cm_raw = 0` heißt „kein Echo", dann ist der gefilterte Wert kein Messwert.
  - **GPS-Genauigkeit** schreibt Companion 4.0.0 nicht. Der Parser liest `gps.hdop`,
    `gps.h_acc_m` und `gps.satellites`, sobald der Logger sie liefert.
- **Altes Format** (JSON-Array mit `position`, `timestamp`, `seeder.status`): Saat = Seeder „on"
  im Modus AUTO (bisherige Regel).

## Berechnungen (js/log-stats.js)

- Kategorien je Abschnitt zwischen zwei Samples: `seed`, `empty`, `transfer` (vom ersten Sample).
- Zeitlücken über 5 s zählen nicht als Flug- oder Saatzeit. Flugzeit = Zeit mit `landed_state`
  2 bis 4 (sonst `armed`).
- **Saatfläche:** Saatlinien werden mit halber Saatbreite gepuffert (Streifen je Linienstück,
  runde Übergänge an Knicken, flache Bahnenden) und auf ein Raster gelegt (Zellgröße =
  Saatbreite / 20, mindestens 0,5 m). Jede Zelle zählt einmal, Überschneidungen innerhalb eines
  Logs und zwischen Logs fallen heraus (`LogStats.aggregate` vereinigt die Zell-Sets).
  Überlappung = 1 − Netto / (Saatstrecke × Saatbreite).
- **Abgeworfenes Gewicht:** Median der stabilen Wägungen in den 30 Samples vor der ersten und
  nach der letzten Saatphase, Differenz.
- **Höhenradar-Minimum** nur während der Saat, **Frontradar-Minimum** im Flug ab 3 m über Start.
- **Mission:** wechselt `mission_count` im Flug, zählt die Wegpunkt-Anzeige ab der neuen Mission.

## Cloud-Logs

- Quelle: Companion-Logs der Drohnen, hochgeladen von `logsync` (Repo copter-companion). Tabelle
  `app_companion.flights` (Metadaten inkl. Bounding Box), Rohdatei als gzip im Bucket.
  `CloudData.downloadFlight` entpackt per `DecompressionStream` und übergibt eine `File` mit dem
  Companion-Dateinamen an `loadFiles()`, deshalb greift die Duplikaterkennung nach Dateiname.
- **Blöcke** sind im Dashboard Seeddrops (`/api/seeddrops/`) mit Feld `geojson`, `area`,
  `project_area_name`, `name`. Das Format von `geojson` ist nicht live gegen Produktivdaten geprüft:
  `polygonsFromGeoJson` liest Feature, FeatureCollection, Polygon, MultiPolygon und Strings.
- **Zuordnung** Cloud-Liste (Flug noch nicht geladen): Bounding Box des Flugs gegen die Außenkontur
  des Blocks (`blocksForFlight`). Kandidaten, kein Beweis, Transferflüge zählen mit.
- **Zuordnung geladener Logs** (`blocksForTrack`, `CloudUI.assignLoaded`): Anteil der Saatpunkte je
  Block (ohne Saatpunkte alle Punkte), Schwelle 5 %. Ergebnis in `log.blockMatch`, neu berechnet
  wenn sich die Blöcke ändern (`blocksVersion`). Wirkt auch für lokal geladene Logs, braucht aber die
  Anmeldung für die Blöcke. Löcher in Block-Polygonen werden ignoriert (nur Außenkontur).
- Das Dashboard wird über `SkyseedAuth.fetchDashboard` gelesen (`prod-read`), nie geschrieben.

## Versionierung

- `APP_VERSION` steht im Inline-Skript von `index.html` und wird im Header angezeigt.
- Während der Entwicklung bleibt die Nummer stehen, Änderungen sammeln sich im `CHANGELOG.md`
  unter `## Unreleased`. Bump erst im Version-PR `develop` → `main`.

## Hinweise für neue Features

- Neues Log-Format oder neues Feld: in `js/log-parser.js` auf das normalisierte Sample abbilden,
  nicht in der Statistik oder UI auf Rohfelder zugreifen.
- Neue Kennzahl: Berechnung in `LogStats.compute` (je Log) und `LogStats.aggregate` (gesamt),
  Anzeige als Eintrag in `TABLE_COLUMNS` in `index.html` (`log` und `agg` je Spalte). Für die
  Seitenleiste zusätzlich `renderKpis`.
- Linienstile je Kategorie in `LINE_STYLE` (`index.html`), Legende in der Seitenleiste mitziehen.
- UI-Arbeit folgt dem Skill `skyseed-design`: Farben, Radien, Schatten nur über Tokens.
- Lokal testen: statischen Server im Ordner `00_Coding` starten und
  `http://localhost:8123/SkySeed_Log_Analyzer/index.html` öffnen; Logs aus `test-logs/` per
  Drag & Drop laden.
