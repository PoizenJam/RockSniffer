using RockSnifferLib.RSHelpers;
using RockSnifferLib.Sniffing;
using System;
using System.Data.SQLite;
using System.Globalization;
using System.IO;
using System.Text;

namespace RockSniffer.History
{
    /// <summary>
    /// Handles playthrough history logging to SQL and CSV
    /// Uses EXACT timestamps from Sniffer.cs Logger.Log calls
    /// </summary>
    public class PlaythroughHistory
    {
        private readonly string sqlitePath;
        private readonly string csvPath;
        private bool sqliteEnabled;
        private bool csvEnabled;

        private SQLiteConnection sqliteConnection;
        private DateTime metadataTimestamp;      // When metadata loaded (OnSongStarted)
        private DateTime actualStartTimestamp;    // When song ACTUALLY started (Logger.Log EVENT=START)
        private DateTime actualEndTimestamp;      // When song ACTUALLY ended (Logger.Log EVENT=END)
        private RSMemoryReadout startReadout;

        public PlaythroughHistory(bool enableSqlite, string sqlitePath, bool enableCsv, string csvPath)
        {
            this.sqliteEnabled = enableSqlite;
            this.sqlitePath = sqlitePath;
            this.csvEnabled = enableCsv;
            this.csvPath = csvPath;

            if (sqliteEnabled)
            {
                InitializeSqlite();
            }

            if (csvEnabled)
            {
                InitializeCsv();
            }
        }

        private void InitializeSqlite()
        {
            try
            {
                bool isNewDatabase = !File.Exists(sqlitePath);
                
                sqliteConnection = new SQLiteConnection($"Data Source={sqlitePath};Version=3;");
                sqliteConnection.Open();

                if (isNewDatabase)
                {
                    CreateTables();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error initializing SQLite: {ex.Message}");
                sqliteEnabled = false;
            }
        }

        private void CreateTables()
        {
            string createTableQuery = @"
                CREATE TABLE IF NOT EXISTS playthrough_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    timestamp_start TEXT NOT NULL,
                    timestamp_end TEXT NOT NULL,
                    song_id TEXT,
                    song_name TEXT,
                    artist_name TEXT,
                    album_name TEXT,
                    album_year INTEGER,
                    song_length REAL,
                    arrangement_id TEXT,
                    game_mode TEXT,
                    author TEXT,
                    total_notes INTEGER,
                    notes_hit INTEGER,
                    notes_missed INTEGER,
                    highest_hit_streak INTEGER,
                    accuracy REAL,
                    completed INTEGER,
                    paused INTEGER
                );";

            using (var command = new SQLiteCommand(createTableQuery, sqliteConnection))
            {
                command.ExecuteNonQuery();
            }
        }

        private void InitializeCsv()
        {
            try
            {
                if (!File.Exists(csvPath))
                {
                    // Create CSV with headers
                    StringBuilder header = new StringBuilder();
                    header.AppendLine("Timestamp,TimestampStart,TimestampEnd,SongID,SongName,ArtistName,AlbumName,AlbumYear,SongLength,ArrangementID,GameMode,Author,TotalNotes,NotesHit,NotesMissed,HighestHitStreak,Accuracy,Completed,Paused");
                    File.WriteAllText(csvPath, header.ToString());
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error initializing CSV: {ex.Message}");
                csvEnabled = false;
            }
        }

        /// <summary>
        /// Called when song metadata is loaded (OnSongStarted event)
        /// </summary>
        public void OnMetadataLoaded(SongDetails song, RSMemoryReadout readout)
        {
            metadataTimestamp = DateTime.Now;
            startReadout = readout?.Clone();
        }

        /// <summary>
        /// Called when Sniffer.cs logs EVENT=START - this is the ACTUAL song start
        /// </summary>
        public void OnActualSongStart(RockSnifferLib.Logging.EventLoggedArgs e)
        {
            actualStartTimestamp = e.Timestamp;
        }

        /// <summary>
        /// Called when Sniffer.cs logs EVENT=END - this is the ACTUAL song end
        /// </summary>
        public void OnActualSongEnd(RockSnifferLib.Logging.EventLoggedArgs e, SongDetails song, RSMemoryReadout readout, bool completed, bool paused)
        {
            if (readout == null || song == null || !song.IsValid())
            {
                return;
            }

            actualEndTimestamp = e.Timestamp;

            if (sqliteEnabled)
            {
                LogToSqlite(song, readout, completed, paused);
            }

            if (csvEnabled)
            {
                LogToCsv(song, readout, completed, paused);
            }
        }

        private void LogToSqlite(SongDetails song, RSMemoryReadout readout, bool completed, bool paused)
        {
            try
            {
                string insertQuery = @"
                    INSERT INTO playthrough_history 
                    (timestamp, timestamp_start, timestamp_end, song_id, song_name, artist_name, album_name, album_year, song_length, 
                     arrangement_id, game_mode, author, total_notes, notes_hit, notes_missed, 
                     highest_hit_streak, accuracy, completed, paused)
                    VALUES 
                    (@timestamp, @timestamp_start, @timestamp_end, @song_id, @song_name, @artist_name, @album_name, @album_year, @song_length,
                     @arrangement_id, @game_mode, @author, @total_notes, @notes_hit, @notes_missed,
                     @highest_hit_streak, @accuracy, @completed, @paused)";

                using (var command = new SQLiteCommand(insertQuery, sqliteConnection))
                {
                    command.Parameters.AddWithValue("@timestamp", metadataTimestamp.ToString("yyyy-MM-dd HH:mm:ss"));
                    command.Parameters.AddWithValue("@timestamp_start", actualStartTimestamp.ToString("yyyy-MM-dd HH:mm:ss"));
                    command.Parameters.AddWithValue("@timestamp_end", actualEndTimestamp.ToString("yyyy-MM-dd HH:mm:ss"));
                    command.Parameters.AddWithValue("@song_id", song.songID ?? "");
                    command.Parameters.AddWithValue("@song_name", song.songName ?? "");
                    command.Parameters.AddWithValue("@artist_name", song.artistName ?? "");
                    command.Parameters.AddWithValue("@album_name", song.albumName ?? "");
                    command.Parameters.AddWithValue("@album_year", song.albumYear);
                    command.Parameters.AddWithValue("@song_length", song.songLength);
                    command.Parameters.AddWithValue("@arrangement_id", readout.arrangementID ?? "");
                    command.Parameters.AddWithValue("@game_mode", readout.mode.ToString());
                    command.Parameters.AddWithValue("@author", song.toolkit?.author ?? "");
                    command.Parameters.AddWithValue("@total_notes", readout.noteData?.TotalNotes ?? 0);
                    command.Parameters.AddWithValue("@notes_hit", readout.noteData?.TotalNotesHit ?? 0);
                    command.Parameters.AddWithValue("@notes_missed", readout.noteData?.TotalNotesMissed ?? 0);
                    command.Parameters.AddWithValue("@highest_hit_streak", readout.noteData?.HighestHitStreak ?? 0);
                    command.Parameters.AddWithValue("@accuracy", readout.noteData?.Accuracy ?? 0.0);
                    command.Parameters.AddWithValue("@completed", completed ? 1 : 0);
                    command.Parameters.AddWithValue("@paused", paused ? 1 : 0);

                    command.ExecuteNonQuery();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error logging to SQLite: {ex.Message}");
            }
        }

        private void LogToCsv(SongDetails song, RSMemoryReadout readout, bool completed, bool paused)
        {
            try
            {
                StringBuilder line = new StringBuilder();
                line.Append($"\"{metadataTimestamp:yyyy-MM-dd HH:mm:ss}\",");
                line.Append($"\"{actualStartTimestamp:yyyy-MM-dd HH:mm:ss}\",");
                line.Append($"\"{actualEndTimestamp:yyyy-MM-dd HH:mm:ss}\",");
                line.Append($"\"{EscapeCsv(song.songID)}\",");
                line.Append($"\"{EscapeCsv(song.songName)}\",");
                line.Append($"\"{EscapeCsv(song.artistName)}\",");
                line.Append($"\"{EscapeCsv(song.albumName)}\",");
                line.Append($"{song.albumYear},");
                line.Append($"{song.songLength.ToString(CultureInfo.InvariantCulture)},");
                line.Append($"\"{EscapeCsv(readout.arrangementID)}\",");
                line.Append($"\"{readout.mode}\",");
                line.Append($"\"{EscapeCsv(song.toolkit?.author ?? "")}\",");
                line.Append($"{readout.noteData?.TotalNotes ?? 0},");
                line.Append($"{readout.noteData?.TotalNotesHit ?? 0},");
                line.Append($"{readout.noteData?.TotalNotesMissed ?? 0},");
                line.Append($"{readout.noteData?.HighestHitStreak ?? 0},");
                line.Append($"{(readout.noteData?.Accuracy ?? 0.0).ToString(CultureInfo.InvariantCulture)},");
                line.Append($"{(completed ? "True" : "False")},");
                line.Append($"{(paused ? "True" : "False")}");

                File.AppendAllText(csvPath, line.ToString() + Environment.NewLine);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error logging to CSV: {ex.Message}");
            }
        }

        private string EscapeCsv(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return "";
            }

            return value.Replace("\"", "\"\"");
        }

        public void Close()
        {
            if (sqliteConnection != null)
            {
                sqliteConnection.Close();
                sqliteConnection.Dispose();
            }
        }
    }
}
