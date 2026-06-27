`Button` is DriveCoding's primary action control — solid accent by default, with elevated, ghost, and destructive variants.

```jsx
<Button onClick={go}>התחבר</Button>
<Button variant="secondary" icon="folder">בחר תיקייה</Button>
<Button variant="danger" icon="refresh-cw">התחבר מחדש</Button>
<Button variant="ghost" pill size="sm" icon="mic">הקלטה</Button>
```

Variants: `primary | secondary | ghost | danger`. Sizes: `sm | md | lg`. `pill` makes it fully rounded (segmented-tab look). `icon` / `iconRight` take an Icon name. Hover lightens primary to `--accent-hi`; ghost gets an `--accent-soft` wash.
