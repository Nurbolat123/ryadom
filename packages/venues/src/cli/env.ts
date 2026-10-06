import { config } from "dotenv";

// Единый .env в корне монорепо. Импортируется первым, до @ryadom/db.
config({ path: new URL("../../../../.env", import.meta.url).pathname });
