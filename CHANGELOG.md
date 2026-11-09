# Changelog

## Unreleased

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
- Oberfläche auf die Skyseed-Design-Tokens umgestellt (`styles/`)
- Satellit ist die Standard-Karte

### 🐛 Fixed
- Straßenkarte lud nicht mehr (CARTO verlangt einen API-Key), jetzt Esri-Straßenkarte

## Version 1.1.0
- Analyse-Features aus alter Version zurückgeführt
