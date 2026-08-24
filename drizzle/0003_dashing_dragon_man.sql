CREATE INDEX `idx_products_model` ON `products` (`normalized_model`);--> statement-breakpoint
CREATE INDEX `idx_products_high_touch` ON `products` (`high_touch`);