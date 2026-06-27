`Select` is a styled native dropdown used in the connect form (CLI kind, voice, language).

```jsx
<Select
  value={cli}
  options={[{value:"claude",label:"claude"},{value:"opencode",label:"opencode"}]}
  onChange={setCli}
  ariaLabel="CLI"
/>
```

Wraps a native `<select>` (best for mobile + a11y) with bg-elev styling and a custom chevron. `options` is `{value,label}[]`.
