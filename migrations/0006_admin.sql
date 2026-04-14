-- Migration: Admin role support
-- Adds is_admin flag to user table for admin section access

ALTER TABLE user ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
