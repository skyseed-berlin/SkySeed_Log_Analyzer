# Konzept: Companion-Logs in der Cloud

Stand: 2026-11-13, Entwurf. Noch nichts umgesetzt. Dieser Branch (`feature/cloud-logs`) enthält nur das Konzept.

## Ziel

Der Copter Companion lädt Flug-Logs von Saatflügen automatisch hoch, sobald Internet da ist. Der
Skyseed Log Analyzer und das Eco Dashboard (die Auswertungs-App der Field App, nicht das
Dashboard/WaWi-Backend) rufen sie später aus derselben Quelle ab.

## Festlegungen

| Thema | Festlegung |
|---|---|
| Saatflug-Kriterium | Mindestens ein Sample mit `drone.mode` AUTO, `seeder.auto_on` und `seeder.target_rpm > 0`, und der Empty-Zustand (`seeder.empty`) war während der Auto-Trigger-Samples nicht durchgehend `empty` |
| Upload-Zeitpunkt | Nach Flugende (`flight_end` geschrieben), sobald Internet vorhanden ist. Ohne Internet wird später erneut versucht, bis die Datei bestätigt ist |
| Dateigröße | Unkritisch, Upload der ganzen Datei (gzip optional) |
| Personenbezug | Keiner |
| Zuordnung zu Flächen und Blöcken | Später im Analyzer oder im Eco Dashboard, über Routen-Daten und Geolocation des Logs gegen die Koordinaten der Flächen und Blöcke im Dashboard. Nicht Teil des Uploads |
| Analyzer | Wird später auf GitHub Pages umgebaut. Der Cloud-Zugriff baut auf dieser Hülle auf |

## Architektur

```
Companion (Pi)  ->  Ingest (Edge Function, Geräte-Key)  ->  Bucket (Rohlog) + Tabelle (Metadaten)
                                                              ^                       ^
                                                   Analyzer (Login)          Eco Dashboard
```

- **Companion:** neuer Connector `logsync` als eigener Prozess (Supervisor, Restart). Kein Eingriff
  in den Flight-Log-Connector. Beobachtet das Verzeichnis `logs/flights`, lädt abgeschlossene
  Dateien (letzte Zeile `flight_end`) hoch, die das Saatflug-Kriterium erfüllen, und markiert sie
  nach Bestätigung des Servers als hochgeladen. Versuch mit Timeout und Backoff, der Fehlschlag
  gilt als "offline". HTTP über die Standardbibliothek, keine neue Abhängigkeit.
- **Saatflug-Flag:** Der Writer berechnet `seeded` und `auto_seconds` beim Flugende und schreibt
  sie in `flight_end`. Der Uploader muss die Datei dann nicht scannen. Der Analyzer-Parser liest
  `flight_end` und sollte die Zusatzfelder ignorieren (zu prüfen).
- **Ingest:** Edge Function mit Geräte-Key (Hash in einer Tabelle, nach dem Muster der
  Schreib-Freigabe des Dashboard-Proxys). Das Gerät bekommt keine Datenbank-Zugangsdaten. Die
  Function schreibt mit der Service-Rolle. Idempotenz über `drone_id` und `started`.
- **Speicher:** privater Bucket für die Rohdatei, Tabelle für Metadaten (`flight_id`, `drone_id`,
  `started`, `ended`, `seeded`, `auto_seconds`, Größe, Ablagepfad, optional Bounding Box). Die
  Liste im Analyzer kommt aus der Tabelle, der Parser braucht keinen Header-only-Modus.
- **Analyzer (nach dem Pages-Umbau):** Login über `skyseed-auth`, neue Sektion neben "Logs
  hinzufügen" mit Liste und Filter nach Flug, Drohne, Datum. Download als `File` in `loadFiles()`,
  Dedup nach `flight_id` statt Dateiname.
- **Eco Dashboard:** liest die Metadaten-Tabelle und die Rohdateien über einen eigenen Lesepfad.

## Offene Punkte

1. Speicherort: entschieden, geteilte Instanz "Skyseed Apps" mit eigenem Schema und privatem
   Bucket. Offen bleibt, wie das Eco Dashboard (liest bisher aus seiner eigenen Instanz) darauf
   zugreift: zweiter Supabase-Client oder Read-Function. Das klärt Dominik.
2. Gerätekennung: heute nur `drone_id` (3 = THOR, 9 = Simulator), keine Seriennummer. Reicht das
   für den Geräte-Key?
3. Aufbewahrung: Der Companion löscht nie, der Pi-Speicher füllt sich. Löschregel nach bestätigtem
   Upload festlegen.
4. Log-Pfad auf dem Pi und reale Dateigröße prüfen.
5. Verhalten bei `empty_sensor` deaktiviert (RC CH5 Stufe 3): Zustand im Log prüfen, bevor das
   Kriterium endgültig gilt.
6. Mindestanteil der nicht leeren Auto-Samples für das Kriterium (jetzt: größer als null).
7. Schreibzugriffe auf Produktivsysteme brauchen die ausdrückliche Bestätigung des Nutzers.
