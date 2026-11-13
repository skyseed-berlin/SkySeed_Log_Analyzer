# Changelog

## Unreleased

### 🚀 Added
- Cloud-Logs: Anmeldung über `skyseed-auth` (Gast-Modus bleibt, lokale Logs brauchen kein Login).
  Die hochgeladenen Saatflüge der Drohnen erscheinen in der Seitenleiste, nach Datum sortiert,
  mit Suche, Datumsfilter, Drohnenfilter und Mehrfachauswahl zum Laden
- Auswahl nach Fläche und Block aus dem Skyseed-Dashboard (mehrere gleichzeitig). Die Zuordnung
  ist ein Kandidatenvergleich der Flug-Bounding-Box mit der Blockgeometrie
- Geladene Logs (lokal oder aus der Cloud) werden nach der Anmeldung Blöcken zugeordnet: Anteil der
  Saatpunkte je Block in der Log-Liste und als Spalte „Fläche / Block" in der Statistik-Tabelle.
  „Geladene Logs nach Auswahl ein-/ausblenden" blendet Logs aus, die in keinem gewählten Block liegen
- Dieselbe Datei aus Cloud und per Drag & Drop wird als Duplikat erkannt (gleicher Dateiname)

### 🔄 Changed
- Neue Abhängigkeiten: Submodul `vendor/skyseed-auth` und supabase-js 2.45.4 per CDN (mit SRI-Hash)

## Version 1.2.0 (2026-11-10)

### 🚀 Added
- Companion-Logs (`flight_*.jsonl`, copter-companion 4.x) lesbar; Formaterkennung am Inhalt,
  das alte JSON-Format bleibt unterstützt
- Logs per Drag & Drop direkt auf die Karte laden, beliebig viele auf einmal
- Saatlinien, Saat bei leerem Behälter und Transferlinien unterscheidbar dargestellt, mit Legende
- Saatbreite einstellbar (Standard 10 m), optional als Streifen auf der Karte
- Saatfläche netto mit herausgerechneten Überschneidungen, innerhalb eines Logs und zwischen Logs
- Statistik-Tabelle je Log mit Gesamtzeile: Flugzeit, Saatzeit, Strecken, Saatbahnen, Fläche,
  Überlappung, abgeworfenes Gewicht, kg/ha, Seeder- und Spreader-RPM, Geschwindigkeit,
  Höhen- und Frontradar-Minimum (Klick zeigt die Stelle), GPS-Genauigkeit, Mission,
  Behälter leer, Seeder nicht erreichbar
- Gesamtwerte der sichtbaren Logs in der Seitenleiste
- Farbe je Log über einen Farbwähler frei wählbar

### 🔄 Changed
- Tabs „Planung" (.plan laden, RPM-Empfehlung) und „Saatgut" (Kalibrierwerte) entfernt. Der
  Analyzer wertet nur noch Logs aus, die Seitenleiste hat keine Tabs mehr
- Oberfläche auf die Skyseed-Design-Tokens umgestellt (`styles/`)
- Satellit ist die Standard-Karte

### 🐛 Fixed
- Straßenkarte lud nicht mehr (CARTO verlangt einen API-Key), jetzt Esri-Straßenkarte

## Version 1.1.0
- Analyse-Features aus alter Version zurückgeführt
