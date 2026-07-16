using System;
using System.Data.SQLite;
using System.IO;

namespace RockSniffer.Addons.Storage
{
    public class SQLiteStorage : IAddonStorage
    {
        private SQLiteConnection Connection { get; set; }

        public SQLiteStorage()
        {
            if (!File.Exists("addonstorage.sqlite"))
            {
                SQLiteConnection.CreateFile("addonstorage.sqlite");
            }
            
            Environment.SetEnvironmentVariable("SQLite_ConfigureDirectory", ".");
            Connection = new SQLiteConnection("Data Source=addonstorage.sqlite;");
            Connection.Open();
        }

        private void CreateTable(string addonkey)
        {
            var q = $@"
            CREATE TABLE IF NOT EXISTS `{addonkey}` (
	            `id`	INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	            `key`	TEXT NOT NULL,
	            `value`	TEXT
            );";

            using (var cmd = Connection.CreateCommand())
            {
                cmd.CommandText = q;
                cmd.ExecuteNonQuery();
            }
        }

        public string GetValue(string addonid, string key)
        {
            //Make sure the table exists
            CreateTable(addonid);

            using (var cmd = Connection.CreateCommand())
            {
                cmd.CommandText = $"SELECT value FROM {addonid} WHERE key=@key";

                cmd.Parameters.AddWithValue("@key", key);

                return (string)cmd.ExecuteScalar();
            }
        }

        public void SetValue(string addonid, string key, string value)
        {
            //Make sure the table exists
            CreateTable(addonid);

            // Skip byte-identical writes: multiple browser sources running the same addon
            // ID can PUT identical content back-to-back. Costs one SELECT (~1ms on
            // localhost) per PUT.
            using (var checkCmd = Connection.CreateCommand())
            {
                checkCmd.CommandText = $"SELECT value FROM {addonid} WHERE key=@key";
                checkCmd.Parameters.AddWithValue("@key", key);

                if (checkCmd.ExecuteScalar() is string existing && existing == value)
                {
                    return;
                }
            }

            Console.WriteLine($"Storing {addonid}/{key} ({value.Length} bytes)");

            //Attempt to update the table
            using (var cmd = Connection.CreateCommand())
            {
                cmd.CommandText = $"UPDATE {addonid} SET value=@value WHERE key=@key";

                cmd.Parameters.AddWithValue("@value", value);
                cmd.Parameters.AddWithValue("@key", key);

                //If update changed more than 0 rows, return
                if (cmd.ExecuteNonQuery() > 0)
                {
                    return;
                }
            }

            using (var cmd = Connection.CreateCommand())
            {
                cmd.CommandText = $@"INSERT INTO {addonid}(key, value) VALUES(@key, @value)";

                cmd.Parameters.AddWithValue("@value", value);
                cmd.Parameters.AddWithValue("@key", key);

                cmd.ExecuteNonQuery();
            }
        }
    }
}
