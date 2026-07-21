-- ==============================================================================
-- Run this in phpMyAdmin (WAMP) or the mysql CLI to create the database +
-- one table PER MATOC (FRR, NAVFAC ME, NAVFAC GU).
--
-- Each table has a UNIQUE KEY on `folder_number` (Excel column 1). That's
-- what makes importing safe to run over and over: a folder number that's
-- already in the table gets its row UPDATED if any value changed, and
-- LEFT ALONE if nothing changed - it never creates a second, duplicate row.
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS bid_intel CHARACTER SET utf8mb4;
USE bid_intel;

CREATE TABLE IF NOT EXISTS bids_frr (
    id                          INT AUTO_INCREMENT PRIMARY KEY,
    folder_number               VARCHAR(50)  NOT NULL,
    eight_a_or_r                VARCHAR(10),
    year                        VARCHAR(10),
    rfp_number                  VARCHAR(100),
    award_id                    VARCHAR(100),
    title                       VARCHAR(255),
    project_type                VARCHAR(150),
    awardee                     VARCHAR(255),
    contract_value              DECIMAL(15,2) DEFAULT 0,
    addon_bid                   DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_usd       DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_pct       DECIMAL(10,4) DEFAULT 0,  -- fraction, e.g. 0.25 = 25%
    number_of_offers_received   INT DEFAULT 0,
    result                      VARCHAR(20),              -- WON / LOST / NB
    mods                        DECIMAL(15,2) DEFAULT 0,
    total                       DECIMAL(15,2) DEFAULT 0,
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uniq_folder_number (folder_number),
    INDEX idx_project_type (project_type),
    INDEX idx_result (result)
);

CREATE TABLE IF NOT EXISTS bids_navfac_me (
    id                          INT AUTO_INCREMENT PRIMARY KEY,
    folder_number               VARCHAR(50)  NOT NULL,
    eight_a_or_r                VARCHAR(10),
    year                        VARCHAR(10),
    rfp_number                  VARCHAR(100),
    award_id                    VARCHAR(100),
    title                       VARCHAR(255),
    project_type                VARCHAR(150),
    awardee                     VARCHAR(255),
    contract_value              DECIMAL(15,2) DEFAULT 0,
    addon_bid                   DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_usd       DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_pct       DECIMAL(10,4) DEFAULT 0,
    number_of_offers_received   INT DEFAULT 0,
    result                      VARCHAR(20),
    mods                        DECIMAL(15,2) DEFAULT 0,
    total                       DECIMAL(15,2) DEFAULT 0,
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uniq_folder_number (folder_number),
    INDEX idx_project_type (project_type),
    INDEX idx_result (result)
);

CREATE TABLE IF NOT EXISTS bids_navfac_gu (
    id                          INT AUTO_INCREMENT PRIMARY KEY,
    folder_number               VARCHAR(50)  NOT NULL,
    eight_a_or_r                VARCHAR(10),
    year                        VARCHAR(10),
    rfp_number                  VARCHAR(100),
    award_id                    VARCHAR(100),
    title                       VARCHAR(255),
    project_type                VARCHAR(150),
    awardee                     VARCHAR(255),
    contract_value              DECIMAL(15,2) DEFAULT 0,
    addon_bid                   DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_usd       DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_pct       DECIMAL(10,4) DEFAULT 0,
    number_of_offers_received   INT DEFAULT 0,
    result                      VARCHAR(20),
    mods                        DECIMAL(15,2) DEFAULT 0,
    total                       DECIMAL(15,2) DEFAULT 0,
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uniq_folder_number (folder_number),
    INDEX idx_project_type (project_type),
    INDEX idx_result (result)
);

CREATE TABLE IF NOT EXISTS bids_nih (
    id                          INT AUTO_INCREMENT PRIMARY KEY,
    folder_number               VARCHAR(50)  NOT NULL,
    eight_a_or_r                VARCHAR(10),
    year                        VARCHAR(10),
    rfp_number                  VARCHAR(100),
    award_id                    VARCHAR(100),
    title                       VARCHAR(255),
    project_type                VARCHAR(150),
    awardee                     VARCHAR(255),
    contract_value              DECIMAL(15,2) DEFAULT 0,
    addon_bid                   DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_usd       DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_pct       DECIMAL(10,4) DEFAULT 0,
    number_of_offers_received   INT DEFAULT 0,
    result                      VARCHAR(20),
    mods                        DECIMAL(15,2) DEFAULT 0,
    total                       DECIMAL(15,2) DEFAULT 0,
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uniq_folder_number (folder_number),
    INDEX idx_project_type (project_type),
    INDEX idx_result (result)
);

CREATE TABLE IF NOT EXISTS bids_usda_mep (
    id                          INT AUTO_INCREMENT PRIMARY KEY,
    folder_number               VARCHAR(50)  NOT NULL,
    eight_a_or_r                VARCHAR(10),
    year                        VARCHAR(10),
    rfp_number                  VARCHAR(100),
    award_id                    VARCHAR(100),
    title                       VARCHAR(255),
    project_type                VARCHAR(150),
    awardee                     VARCHAR(255),
    contract_value              DECIMAL(15,2) DEFAULT 0,
    addon_bid                   DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_usd       DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_pct       DECIMAL(10,4) DEFAULT 0,
    number_of_offers_received   INT DEFAULT 0,
    result                      VARCHAR(20),
    mods                        DECIMAL(15,2) DEFAULT 0,
    total                       DECIMAL(15,2) DEFAULT 0,
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uniq_folder_number (folder_number),
    INDEX idx_project_type (project_type),
    INDEX idx_result (result)
);

CREATE TABLE IF NOT EXISTS bids_usace_dha_areli(
    id                          INT AUTO_INCREMENT PRIMARY KEY,
    folder_number               VARCHAR(50)  NOT NULL,
    eight_a_or_r                VARCHAR(10),
    year                        VARCHAR(10),
    rfp_number                  VARCHAR(100),
    award_id                    VARCHAR(100),
    title                       VARCHAR(255),
    project_type                VARCHAR(150),
    awardee                     VARCHAR(255),
    contract_value              DECIMAL(15,2) DEFAULT 0,
    addon_bid                   DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_usd       DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_pct       DECIMAL(10,4) DEFAULT 0,
    number_of_offers_received   INT DEFAULT 0,
    result                      VARCHAR(20),
    mods                        DECIMAL(15,2) DEFAULT 0,
    total                       DECIMAL(15,2) DEFAULT 0,
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uniq_folder_number (folder_number),
    INDEX idx_project_type (project_type),
    INDEX idx_result (result)
);

CREATE TABLE IF NOT EXISTS bids_usace_dha_2a(
    id                          INT AUTO_INCREMENT PRIMARY KEY,
    folder_number               VARCHAR(50)  NOT NULL,
    eight_a_or_r                VARCHAR(10),
    year                        VARCHAR(10),
    rfp_number                  VARCHAR(100),
    award_id                    VARCHAR(100),
    title                       VARCHAR(255),
    project_type                VARCHAR(150),
    awardee                     VARCHAR(255),
    contract_value              DECIMAL(15,2) DEFAULT 0,
    addon_bid                   DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_usd       DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_pct       DECIMAL(10,4) DEFAULT 0,
    number_of_offers_received   INT DEFAULT 0,
    result                      VARCHAR(20),
    mods                        DECIMAL(15,2) DEFAULT 0,
    total                       DECIMAL(15,2) DEFAULT 0,
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uniq_folder_number (folder_number),
    INDEX idx_project_type (project_type),
    INDEX idx_result (result)
);

CREATE TABLE IF NOT EXISTS bids_micc_ft_drum(
    id                          INT AUTO_INCREMENT PRIMARY KEY,
    folder_number               VARCHAR(50)  NOT NULL,
    eight_a_or_r                VARCHAR(10),
    year                        VARCHAR(10),
    rfp_number                  VARCHAR(100),
    award_id                    VARCHAR(100),
    title                       VARCHAR(255),
    project_type                VARCHAR(150),
    awardee                     VARCHAR(255),
    contract_value              DECIMAL(15,2) DEFAULT 0,
    addon_bid                   DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_usd       DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_pct       DECIMAL(10,4) DEFAULT 0,
    number_of_offers_received   INT DEFAULT 0,
    result                      VARCHAR(20),
    mods                        DECIMAL(15,2) DEFAULT 0,
    total                       DECIMAL(15,2) DEFAULT 0,
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uniq_folder_number (folder_number),
    INDEX idx_project_type (project_type),
    INDEX idx_result (result)
);

CREATE TABLE IF NOT EXISTS bids_usag_hi(
    id                          INT AUTO_INCREMENT PRIMARY KEY,
    folder_number               VARCHAR(50)  NOT NULL,
    eight_a_or_r                VARCHAR(10),
    year                        VARCHAR(10),
    rfp_number                  VARCHAR(100),
    award_id                    VARCHAR(100),
    title                       VARCHAR(255),
    project_type                VARCHAR(150),
    awardee                     VARCHAR(255),
    contract_value              DECIMAL(15,2) DEFAULT 0,
    addon_bid                   DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_usd       DECIMAL(15,2) DEFAULT 0,
    winner_price_diff_pct       DECIMAL(10,4) DEFAULT 0,
    number_of_offers_received   INT DEFAULT 0,
    result                      VARCHAR(20),
    mods                        DECIMAL(15,2) DEFAULT 0,
    total                       DECIMAL(15,2) DEFAULT 0,
    created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uniq_folder_number (folder_number),
    INDEX idx_project_type (project_type),
    INDEX idx_result (result)
);
-- ------------------------------------------------------------------------
-- If you already have the OLD single "bids" table with a `matoc` column
-- from a previous version of this app, migrate its data into the 3 new
-- tables like this (safe to skip if you're starting fresh):
--
-- INSERT INTO bids_frr (folder_number, eight_a_or_r, year, rfp_number, award_id,
--     title, project_type, awardee, contract_value, addon_bid,
--     winner_price_diff_usd, winner_price_diff_pct, number_of_offers_received,
--     result, mods, total)
-- SELECT folder_number, eight_a_or_r, year, rfp_number, award_id, title,
--     project_type, awardee, contract_value, addon_bid, winner_price_diff_usd,
--     winner_price_diff_pct, number_of_offers_received, result, mods, total
-- FROM bids WHERE matoc = 'FRR';
-- (repeat for 'NAVFAC ME' -> bids_navfac_me and 'NAVFAC GU' -> bids_navfac_gu)
-- ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
);