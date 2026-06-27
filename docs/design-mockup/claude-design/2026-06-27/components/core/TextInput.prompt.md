`TextInput` is the product's text field — single-line (paths) or multiline (prompt composer).

```jsx
<TextInput value={cwd} onChange={setCwd} placeholder="/home/user/project" dir="ltr" />
<TextInput multiline rows={2} surface="card" placeholder="כתבי הודעה…" />
```

`multiline` switches to a textarea. `surface`: `elev | card`. Defaults `dir="auto"` for mixed Hebrew/Latin. Accent focus ring on focus.
