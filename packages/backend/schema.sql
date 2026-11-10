CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL UNIQUE,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  invite_code VARCHAR(32) UNIQUE,
  parent_id BIGINT UNSIGNED NULL,
  is_root BOOLEAN NOT NULL DEFAULT FALSE,
  root_singleton TINYINT GENERATED ALWAYS AS (CASE WHEN is_root = 1 THEN 1 ELSE NULL END) STORED,
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  purchase_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_parent (parent_id),
  UNIQUE KEY uq_single_root (root_singleton),
  FOREIGN KEY (parent_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admins (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT '未分类',
  description TEXT NOT NULL,
  image VARCHAR(1000) NOT NULL DEFAULT '',
  detail_images JSON NULL,
  options JSON NULL,
  cost DECIMAL(12,2) NOT NULL,
  reward DECIMAL(12,2) NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS addresses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  contact_name VARCHAR(100) NOT NULL,
  contact_phone VARCHAR(20) NOT NULL,
  province VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  district VARCHAR(100) NOT NULL,
  detail VARCHAR(500) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_addresses_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  variant VARCHAR(200) NULL,
  address JSON NOT NULL,
  cost DECIMAL(12,2) NOT NULL,
  reward DECIMAL(12,2) NOT NULL,
  purchase_sequence INT UNSIGNED NOT NULL,
  recipient_id BIGINT UNSIGNED NOT NULL,
  reward_destination ENUM('ancestor','root') NOT NULL,
  status ENUM('pending','paid','shipped','completed','cancelled') NOT NULL DEFAULT 'completed',
  pickup_code VARCHAR(100) NULL,
  pickup_message VARCHAR(500) NULL,
  notice_read BOOLEAN NOT NULL DEFAULT FALSE,
  received_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_request (user_id, request_id),
  INDEX idx_orders_created (created_at),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (recipient_id) REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coupon_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type ENUM('topup','purchase','reward','transfer_in','transfer_out') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  description VARCHAR(255) NOT NULL,
  order_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_transactions_user (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transfers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sender_id BIGINT UNSIGNED NOT NULL,
  recipient_id BIGINT UNSIGNED NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_transfer_request (sender_id, request_id),
  FOREIGN KEY (sender_id) REFERENCES users(id),
  FOREIGN KEY (recipient_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS topups (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_topup_request (admin_id, request_id),
  FOREIGN KEY (admin_id) REFERENCES admins(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
