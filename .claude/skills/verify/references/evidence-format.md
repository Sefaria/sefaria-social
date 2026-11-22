# Evidence block format

````markdown
### Evidence

| Check     | Command                                              | Result                      |
| --------- | ---------------------------------------------------- | --------------------------- |
| typecheck | `npm run typecheck`                                  | PASS                        |
| gate      | `npm run factory -- gate --base origin/m/f1-factory` | FAIL: spec 000 not approved |

<details><summary>Output</summary>

```
<the real output, trimmed to the relevant lines, never edited>
```

</details>

Adversarial probe: removed the `@feature HOST-000` tag; `npm run factory -- atlas` printed "HOST-000 … is built but no test
is tagged"; restored.

VERDICT: FAIL (gate: awaiting human approval of spec 000)
````
