# Plan: 003 ctx codec

`app/src/lib/ctx.ts`: `encodeCtx`, `decodeCtx`, `readCtx`, `withCtx`, `withoutCtx`, working on the raw query string (split on
`&`, never re-encoding other parameters). Tests in `app/src/lib/ctx.test.ts`, one or more per AC, loading the module with
`import.meta.glob` so they are red on the merge base for an assertion reason.
