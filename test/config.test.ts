import assert from "node:assert/strict";
import { test } from "node:test";

import { describeDatabaseUrl } from "../src/config";

test("describeDatabaseUrl redacts passwords and query strings", () => {
  const description = describeDatabaseUrl(
    "postgres://alice:secret@db.example.com:5432/app?sslmode=require",
  );

  assert.equal(
    description,
    "postgres://db.example.com:5432 database=app user=alice",
  );
  assert.equal(description.includes("secret"), false);
  assert.equal(description.includes("sslmode"), false);
});

test("describeDatabaseUrl handles unparsable values without echoing them", () => {
  assert.equal(
    describeDatabaseUrl("not a url with password=secret"),
    "DATABASE_URL is set but is not a parseable URL",
  );
});
