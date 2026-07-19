namespace RockSniffer.Configuration
{
    public class HistorySettings
    {
        // Persistent playthrough history sinks. Both default off; either or both
        // can be enabled independently.
        public bool enableSqliteHistory = false;
        public string sqliteHistoryPath = "output/playthrough_history.db";
        public bool enableCsvHistory = false;
        public string csvHistoryPath = "output/playthrough_history.csv";
    }
}
