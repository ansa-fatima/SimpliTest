# TCMS — Test Case Management System

A production-grade Test Case Management System built with **Next.js 14**, **React 18**, **TypeScript**, and **Tailwind CSS**.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| UI Library | React 18 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 |
| Font | DM Sans + DM Mono (Google Fonts) |
| State | Custom `useStore` hook (useState) |

---

## Project Structure

```
tcms/
├── app/
│   ├── layout.tsx                # Root layout (fonts, metadata)
│   ├── page.tsx                  # Entry point — wires all pages
│   └── globals.css               # Tailwind + scrollbar styles
│
├── components/
│   ├── layout/
│   │   └── Sidebar.tsx           # Module/feature tree navigation
│   ├── features/
│   │   ├── LoginPage.tsx         # Login screen
│   │   ├── TestCaseList.tsx      # Table view with search
│   │   ├── TestCaseView.tsx      # Read-only detail view
│   │   ├── TestCaseEdit.tsx      # Editable form
│   │   └── NewTestCaseModal.tsx  # Create modal
│   └── ui/
│       ├── Badge.tsx             # Coloured status badge
│       ├── Button.tsx            # Button (primary/default/danger)
│       ├── SegmentedControl.tsx  # Toggle group
│       ├── StepEditor.tsx        # Dynamic step list
│       └── Toast.tsx             # Notification toast
│
├── hooks/
│   └── useStore.ts               # Central state (data + navigation)
│
├── data/
│   └── testCases.ts              # 30+ seed test cases
│
├── lib/
│   └── utils.ts                  # cn(), badge helpers, utils
│
└── types/
    └── index.ts                  # TypeScript interfaces
```

---

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

**Login:** any email / any password

### Production Build

```bash
npm run build && npm start
```

---

## Features

- **Sidebar navigation** — collapsible module/feature tree
- **Test case list** — searchable table with row actions
- **View page** — full read-only detail with props bar
- **Edit page** — inline form with priority/severity/type selectors
- **New test case modal** — cascading module → feature dropdowns
- **Toast notifications** — save / create / delete / duplicate
- **30+ seed test cases** across Authentication, Dashboard, User Management

## Data Model

```typescript
interface TestCase {
  id: string;           // "TC-00042"
  title: string;
  priority: 'High' | 'Medium' | 'Low';
  severity: 'Critical' | 'Major' | 'Minor';
  type: 'Functional' | 'Regression' | 'Smoke' | 'Sanity' | 'UI' | 'API';
  feature: string;
  steps: string[];
  expected: string;
}
```

## Licence
MIT
