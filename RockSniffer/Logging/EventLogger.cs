using RockSniffer.Configuration;
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace RockSniffer.Logging
{
    /// <summary>
    /// Handles configurable EVENT START/END logging to console and sniffer.log
    /// </summary>
    public static class EventLogger
    {
        public static EventLogMode eventLogMode = EventLogMode.Disabled;

        public static void Initialize()
        {
            // Subscribe to Logger events
            RockSnifferLib.Logging.Logger.OnEventStartLogged += OnEventStart;
            RockSnifferLib.Logging.Logger.OnEventEndLogged += OnEventEnd;
        }

        private static void OnEventStart(object sender, RockSnifferLib.Logging.EventLoggedArgs e)
        {
            if (eventLogMode == EventLogMode.Disabled) return;
            if (eventLogMode == EventLogMode.Enabled)
            {
                LogPrettyStart(e.Timestamp, e.Message);
            }
            else if (eventLogMode == EventLogMode.Legacy)
            {
                LogLegacy(e.Timestamp, e.Message);
            }
        }

        private static void OnEventEnd(object sender, RockSnifferLib.Logging.EventLoggedArgs e)
        {
            if (eventLogMode == EventLogMode.Disabled) return;
            if (eventLogMode == EventLogMode.Enabled)
            {
                LogPrettyEnd(e.Timestamp, e.Message);
            }
            else if (eventLogMode == EventLogMode.Legacy)
            {
                LogLegacy(e.Timestamp, e.Message);
            }
        }

        private static void LogLegacy(DateTime timestamp, string message)
        {
            // Format exactly like Sniffer.cs does: [timestamp] message
            string output = $"[{timestamp}] {message}";
            
            Console.WriteLine(output);
            WriteToLog(output);
        }

        private static void LogPrettyStart(DateTime timestamp, string message)
        {
            var data = ParseEventMessage(message);

            StringBuilder sb = new StringBuilder();
            sb.AppendLine("______________________");
            sb.AppendLine("===== SONG START =====");
            sb.AppendLine($"Time: {timestamp:yyyy-MM-dd HH:mm:ss}");
            sb.AppendLine($"Song: {data.GetValueOrDefault("song", "Unknown")} by {data.GetValueOrDefault("artist", "Unknown")}");
            sb.AppendLine($"Album: {data.GetValueOrDefault("album", "Unknown")} ({data.GetValueOrDefault("year", "Unknown")})");
            sb.AppendLine($"Author: {data.GetValueOrDefault("author", "Official DLC")}");
            sb.AppendLine($"Path: {data.GetValueOrDefault("path", "Unknown")}");
            sb.AppendLine($"Tuning: {data.GetValueOrDefault("tuning", "Unknown")}");
            sb.AppendLine($"Length: {data.GetValueOrDefault("length", "Unknown")}s");

            Console.WriteLine(sb.ToString());
            WriteToLog(sb.ToString());
        }

        private static void LogPrettyEnd(DateTime timestamp, string message)
        {
            var data = ParseEventMessage(message);

            StringBuilder sb = new StringBuilder();
            sb.AppendLine("====== SONG END ======");
            sb.AppendLine($"Time: {timestamp:yyyy-MM-dd HH:mm:ss}");
            sb.AppendLine($"Completed: {data.GetValueOrDefault("completed", "Unknown")}");
            sb.AppendLine($"Paused: {data.GetValueOrDefault("paused", "Unknown")}");
            sb.AppendLine($"Performance:");
            sb.AppendLine($"  Accuracy: {data.GetValueOrDefault("accuracy", "Unknown")}");
            sb.AppendLine($"  Total Notes: {data.GetValueOrDefault("totalNotes", "Unknown")}");
            sb.AppendLine($"  Notes Hit: {data.GetValueOrDefault("notesHit", "Unknown")}");
            sb.AppendLine($"  Highest Streak: {data.GetValueOrDefault("highestStreak", "Unknown")}");
            sb.AppendLine("______________________");

            Console.WriteLine(sb.ToString());
            WriteToLog(sb.ToString());
        }

        private static Dictionary<string, string> ParseEventMessage(string message)
        {
            var data = new Dictionary<string, string>();
            
            string[] parts = message.Split(';');
            foreach (string part in parts)
            {
                if (string.IsNullOrEmpty(part)) continue;

                int equalsIndex = part.IndexOf('=');
                if (equalsIndex > 0)
                {
                    string key = part.Substring(0, equalsIndex).Trim();
                    string value = part.Substring(equalsIndex + 1).Trim();
                    data[key] = value;
                }
            }

            return data;
        }

        private static void WriteToLog(string text)
        {
            try
            {
                using (var fstream = new FileStream("sniffer.log", FileMode.Append, FileAccess.Write, FileShare.Read))
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(text + "\r\n");
                    fstream.Write(bytes, 0, bytes.Length);
                }
            }
            catch
            {
                // Silently fail
            }
        }
    }
}
