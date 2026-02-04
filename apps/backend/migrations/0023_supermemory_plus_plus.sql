-- Migration: Supermemory++ Architecture Upgrade - Phase 1: PURGE
-- Purpose: Drop over-engineered cognitive layer
--
-- This migration removes the unused beliefs, outcomes, learnings, and sleep
-- compute systems (which had 0 users and added complexity without value).

-- ============================================
-- PHASE 1: DROP COGNITIVE LAYER TABLES
-- ============================================

-- Drop views first (they depend on tables)
DROP VIEW IF EXISTS v_beliefs_with_evidence;
DROP VIEW IF EXISTS v_outcomes_summary;
DROP VIEW IF EXISTS v_source_effectiveness;

-- Drop cognitive layer tables (unused - had 0 entries in production)
DROP TABLE IF EXISTS belief_conflicts;
DROP TABLE IF EXISTS belief_evidence;
DROP TABLE IF EXISTS beliefs;
DROP TABLE IF EXISTS outcome_sources;
DROP TABLE IF EXISTS outcomes;
DROP TABLE IF EXISTS learning_evidence;
DROP TABLE IF EXISTS learnings;
DROP TABLE IF EXISTS learning_backfill_progress;
DROP TABLE IF EXISTS session_contexts;
DROP TABLE IF EXISTS sleep_jobs;

-- ============================================
-- COMPLETE
-- ============================================
-- Cognitive layer has been purged.
-- Phase 2 (adding Supermemory++ columns) is in 0024_supermemory_columns.sql
