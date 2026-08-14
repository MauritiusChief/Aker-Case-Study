import { createConnection } from "./db/index.js";
import { createApp } from "./app.js";
import { PORT } from "./config.js";

const db = createConnection();
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Aker server listening on http://localhost:${PORT}`);
});
