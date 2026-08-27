--
-- Database: `chart`
--
CREATE DATABASE IF NOT EXISTS `chart` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `chart`;

-- --------------------------------------------------------

--
-- Table structure for table `award_master`
--

DROP TABLE IF EXISTS `award_master`;
CREATE TABLE IF NOT EXISTS `award_master` (
  `id` int NOT NULL AUTO_INCREMENT,
  `piid` varchar(150) NOT NULL,
  `generated_internal_id` varchar(150) DEFAULT NULL,
  `description` text,
  `recipient_name` varchar(255) DEFAULT NULL,
  `total_obligation` decimal(18,2) DEFAULT NULL,
  `base_exercised_options` decimal(18,2) DEFAULT NULL,
  `base_and_all_options` decimal(18,2) DEFAULT NULL,
  `status` varchar(30) DEFAULT 'pending',
  `fetched_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_piid` (`piid`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `award_modifications`
--

DROP TABLE IF EXISTS `award_modifications`;
CREATE TABLE IF NOT EXISTS `award_modifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `award_master_id` int NOT NULL,
  `modification_number` varchar(50) DEFAULT NULL,
  `action_date` date DEFAULT NULL,
  `description` text,
  `federal_action_obligation` decimal(18,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `award_master_id` (`award_master_id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `matoc_config`
--

DROP TABLE IF EXISTS `matoc_config`;
CREATE TABLE IF NOT EXISTS `matoc_config` (
  `slug` varchar(64) NOT NULL,
  `label` varchar(150) NOT NULL,
  `table_name` varchar(64) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`slug`),
  UNIQUE KEY `table_name` (`table_name`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `matoc_contracts`
--

DROP TABLE IF EXISTS `matoc_contracts`;
CREATE TABLE IF NOT EXISTS `matoc_contracts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `matoc_number` varchar(100) DEFAULT NULL,
  `matoc_name` varchar(255) DEFAULT NULL,
  `contract_number` varchar(100) DEFAULT NULL,
  `business_name` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
CREATE TABLE IF NOT EXISTS `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(100) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_admin` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `username`, `email`, `password`, `created_at`, `is_admin`, `is_super_admin`) VALUES
(1, 'Saieesh', 'saieeshnaik25@gmail.com', 'scrypt:32768:8:1$dWW38mQf1qPyGIta$3b77741db6a4d8cdac148a6109499312a65d01096a979b4b27dfda9217ddc1054e837e769849cd81fbe3efea0c9c2d930dbe3e48cc724e01f5bdfed9c0d98bde', '2026-07-27 20:40:08', 1, 1),
COMMIT;

--
-- Table structure for table `user_sessions`
--

DROP TABLE IF EXISTS `user_sessions`;
CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `session_id` varchar(255) NOT NULL,
  `login_time` datetime NOT NULL,
  `last_activity` datetime NOT NULL,
  `expires_at` datetime NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  `is_active` tinyint(1) DEFAULT '1'
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

ALTER TABLE users ADD COLUMN is_super_admin TINYINT(1) DEFAULT 0;