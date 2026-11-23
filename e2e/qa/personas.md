# QA personas

One identity across the browser and the API (plan 5.5). The runner signs in only through the test-only persona route
(`specs/082-test-personas/`), which exists only when the environment name matches the test pattern and the per-run secret
header is present. No real people: names are invented, emails use the reserved `example.test` domain.

| Persona      | Who                                                             | Use for                                                |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------ |
| `signed-out` | A visitor with no session                                       | Public pages; every refusal of a protected route       |
| `learner`    | A signed-in user, member of no room                             | Feed, joining a public room, settings                  |
| `host`       | A signed-in user who created the seeded room `room-seeded-0001` | Room lobby as owner, follow and enlarge as the leader  |
| `follower`   | A second signed-in user, member of `room-seeded-0001`           | Two-context journeys: following, presence              |
| `deleted`    | A user whose Django account was deleted (deletion webhook ran)  | Every social record of theirs is gone; sign-in refused |

How a session is obtained (once the route exists):

```
curl -s -X POST http://127.0.0.1:3200/api/test/persona \
  -H "x-qa-persona-secret: $QA_PERSONA_SECRET" -H 'content-type: application/json' -d '{"persona":"learner"}'
```

The response carries the persona's bearer token for API calls and a one-time sign-in URL for the harness. The runner proves the
session is authenticated with a protected request (`GET /api/v1/me` returns the persona's id), not by a page loading.
