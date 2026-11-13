# Skyseed Log Analyzer

Browser-App zur Auswertung von Saatflug-Logs auf der Karte. Läuft ohne Installation direkt im
Browser (`index.html` öffnen).

## Verwendung

1. `index.html` im Browser öffnen (Chrome oder Edge).
2. Logs per Drag & Drop auf die Karte ziehen, beliebig viele auf einmal. Alternativ über
   „Logs hinzufügen".
3. Unterstützte Formate:
   - Companion-Logs `flight_*.jsonl` (copter-companion 4.x)
   - alte Seed-Logs als JSON-Array

## Cloud-Logs

Die Drohnen laden Saatflug-Logs automatisch hoch. In der Seitenleiste unter „Cloud-Logs" (nach
Anmeldung mit dem Skyseed-Login) lassen sie sich laden:

- Liste nach Datum, neueste zuerst. Suche nach Datum, Drohne, Fläche oder Block, Datumsfilter,
  Drohnenfilter. Testflüge (Simulator) sind standardmäßig ausgeblendet.
- „Fläche / Block": Auswahl aus dem Dashboard, mehrere Blöcke gleichzeitig. Die Zuordnung ist ein
  Kandidatenvergleich: der Flugbereich (Bounding Box) berührt den Block. Ein Transferflug über
  einen Block zählt dabei mit.
- Mehrere Flüge ankreuzen und gemeinsam laden. Bereits geladene Flüge sind markiert.
- **Geladene Logs zuordnen:** Nach der Anmeldung zeigt die Log-Liste je Log die Blöcke mit dem
  Anteil der Saatpunkte darin (auch für lokal per Drag & Drop geladene Logs). „Geladene Logs nach
  Auswahl ein-/ausblenden" blendet Logs aus, die in keinem gewählten Block liegen. Die Zuordnung
  nutzt die Saatpunkte, Transferstrecken zählen nicht. Blöcke mit weniger als 5 % der Punkte fallen heraus.
- Ohne Anmeldung („Ohne Anmeldung fortfahren") bleibt das Laden lokaler Dateien möglich.

Submodule beim Klonen holen: `git submodule update --init --recursive` (`skyseed-auth` ist ein
privates Repo).

## Karte

- Jedes Log bekommt eine eigene Farbe. Klick auf das Farbfeld in der Log-Liste öffnet den
  Farbwähler.
- **Saatlinie:** durchgezogen. **Saat bei leerem Behälter:** gepunktet.
  **Transferlinie:** dünn gestrichelt.
- „Saatbreite auf der Karte zeigen" blendet die gestreute Breite als Streifen ein.
- Je Log: ein- und ausblenden (Auge), als Favorit markieren (Stern), entfernen (Papierkorb),
  Reihenfolge per Ziehen am Griff ändern. Klick auf ein Log zoomt dorthin, Klick auf eine Linie
  zeigt die Eckdaten.

## Statistik

Die Seitenleiste zeigt Gesamtwerte über alle sichtbaren Logs. „Statistik-Tabelle zeigen" öffnet
unten eine Tabelle mit einer Zeile je Log und einer Gesamtzeile:

| Kennzahl | Bedeutung |
|---|---|
| Flugzeit, Saatzeit, Saatanteil | Zeit in der Luft, Zeit mit laufendem Seeder (ohne leeren Behälter) |
| Strecke, Saatstrecke, Transfer | geflogene Strecke gesamt und nach Kategorie |
| Saat bei leerem Behälter | Seeder lief, Leersensor meldete „empty" |
| Saatbahnen | zusammenhängende Saatabschnitte ab 5 m |
| Saatfläche netto | Saatlinien × Saatbreite, Überschneidungen herausgerechnet (auch zwischen Logs) |
| Überlappung | Anteil der doppelt gesäten Fläche |
| Abgeworfen, Ausbringung | Gewicht vor der ersten minus nach der letzten Saatphase, kg/ha |
| Seeder RPM Soll/Ist, Spreader RPM | Durchschnitt während der Saat bzw. solange der Spreader läuft |
| Ø Saat-Geschw., max. Geschw. | Bodengeschwindigkeit |
| Höhenradar min./Median, Frontradar min. | Klick auf den Wert zeigt die Stelle auf der Karte |
| GPS-Genauigkeit | nur, wenn das Log sie enthält (Companion 4.0.0 schreibt sie nicht) |
| Mission, Behälter leer ab, Seeder nicht erreichbar | Ablauf und Auffälligkeiten |

Die Saatbreite (Standard 10 m) ist in der Seitenleiste einstellbar.

## Hinweis

Das Repository ist öffentlich. Echte Flug-Logs enthalten GPS-Positionen und werden nicht
eingecheckt (`.gitignore`).
