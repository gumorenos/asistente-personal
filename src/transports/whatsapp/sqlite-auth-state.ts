import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from 'baileys';
import type { AppDatabase } from '../../database/db.ts';

interface SqliteAuthState {
  state: AuthenticationState;
  saveCreds(): Promise<void>;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

function deserialize<T>(value: string): T {
  return JSON.parse(value, BufferJSON.reviver) as T;
}

export async function useSqliteAuthState(
  database: AppDatabase,
  sessionId = 'default',
): Promise<SqliteAuthState> {
  const readCreds = (): AuthenticationCreds | undefined => {
    const row = database.native
      .prepare('SELECT value_json FROM whatsapp_auth_creds WHERE session_id = ?')
      .get(sessionId) as { value_json: string } | undefined;
    return row ? deserialize<AuthenticationCreds>(row.value_json) : undefined;
  };

  const creds = readCreds() ?? initAuthCreds();

  const saveCreds = async (): Promise<void> => {
    database.native
      .prepare(`
        INSERT INTO whatsapp_auth_creds(session_id, value_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(session_id) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(sessionId, serialize(creds));
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[],
      ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        const statement = database.native.prepare(`
          SELECT value_json
          FROM whatsapp_auth_keys
          WHERE session_id = ? AND category = ? AND key_id = ?
        `);

        for (const id of ids) {
          const row = statement.get(sessionId, type, id) as { value_json: string } | undefined;
          if (!row) continue;

          let value = deserialize<SignalDataTypeMap[T]>(row.value_json);
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.create(value) as SignalDataTypeMap[T];
          }
          result[id] = value;
        }

        return result;
      },
      set: async (data) => {
        const upsert = database.native.prepare(`
          INSERT INTO whatsapp_auth_keys(session_id, category, key_id, value_json, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(session_id, category, key_id) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = CURRENT_TIMESTAMP
        `);
        const remove = database.native.prepare(`
          DELETE FROM whatsapp_auth_keys
          WHERE session_id = ? AND category = ? AND key_id = ?
        `);

        database.native.exec('BEGIN IMMEDIATE');
        try {
          for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
            const categoryData = data[category];
            if (!categoryData) continue;
            for (const id of Object.keys(categoryData)) {
              const value = categoryData[id];
              if (value) upsert.run(sessionId, category, id, serialize(value));
              else remove.run(sessionId, category, id);
            }
          }
          database.native.exec('COMMIT');
        } catch (error) {
          database.native.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };

  return { state, saveCreds };
}
