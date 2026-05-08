import { TestCase } from '@/types';

// Empty seed — test cases live in the DB. The frontend test-case state will be
// wired to the API in a future change; for now, no cases are pre-seeded into
// in-memory state so the app reflects what's actually persisted.
export const SEED_DATA: Record<string, TestCase[]> = {};
