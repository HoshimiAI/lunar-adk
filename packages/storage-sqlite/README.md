# @lunar/storage-sqlite

SQLite implementations of the foundation run and session storage ports.

```ts
import { createSqliteStores } from "@lunar/storage-sqlite";

const storage = createSqliteStores("lunar.db");
```

Use `":memory:"` for isolated tests. Call `storage.close()` during shutdown.
