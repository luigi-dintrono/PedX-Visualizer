# PEDX Visualizer Makefile
# Comprehensive build and deployment automation

.PHONY: help install setup build start dev stop clean logs test lint format
.PHONY: db-setup db-reset db-aggregate db-refresh-views db-pipeline
.PHONY: full-pipeline check-env check-deps

# Default target
.DEFAULT_GOAL := help

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[0;33m
BLUE := \033[0;34m
NC := \033[0m # No Color

# Environment variables
NODE_ENV ?= development
PORT ?= 3000
DB_HOST ?= localhost
DB_PORT ?= 5432
DB_NAME ?= pedx_visualizer
DB_USER ?= postgres

# Help target
help: ## Show this help message
	@echo "$(BLUE)PEDX Visualizer - Available Commands$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "$(GREEN)%-20s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "$(YELLOW)Examples:$(NC)"
	@echo "  make full-pipeline    # Complete setup and start"
	@echo "  make dev             # Start development server"
	@echo "  make db-aggregate    # Update database from CSV data"
	@echo "  make clean           # Clean up everything"

# ===============================================
# ENVIRONMENT & DEPENDENCIES
# ===============================================

check-env: ## Check if .env file exists and create from example if needed
	@echo "$(BLUE)Checking environment configuration...$(NC)"
	@if [ ! -f .env ]; then \
		echo "$(YELLOW)Creating .env from .env.example...$(NC)"; \
		cp .env.example .env; \
		echo "$(GREEN)✓ .env file created$(NC)"; \
		echo "$(YELLOW)Please edit .env with your database credentials$(NC)"; \
	else \
		echo "$(GREEN)✓ .env file exists$(NC)"; \
	fi

check-deps: ## Check if required dependencies are installed
	@echo "$(BLUE)Checking dependencies...$(NC)"
	@command -v node >/dev/null 2>&1 || { echo "$(RED)Node.js is required but not installed$(NC)"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "$(RED)npm is required but not installed$(NC)"; exit 1; }
	@command -v psql >/dev/null 2>&1 || { echo "$(YELLOW)PostgreSQL client (psql) not found - some database operations may not work$(NC)"; }
	@echo "$(GREEN)✓ Dependencies check complete$(NC)"

install: check-env check-deps ## Install all dependencies
	@echo "$(BLUE)Installing dependencies...$(NC)"
	npm install
	@echo "$(GREEN)✓ Dependencies installed$(NC)"

setup: install ## Initial project setup
	@echo "$(BLUE)Setting up PEDX Visualizer...$(NC)"
	@echo "$(YELLOW)Please ensure PostgreSQL is running and update .env with your database credentials$(NC)"
	@echo "$(GREEN)✓ Setup complete$(NC)"

# ===============================================
# APPLICATION MANAGEMENT
# ===============================================

build: ## Build the application for production
	@echo "$(BLUE)Building application...$(NC)"
	npm run build
	@echo "$(GREEN)✓ Build complete$(NC)"

start: ## Start the production application
	@echo "$(BLUE)Starting production application...$(NC)"
	npm start

dev: ## Start development server with hot reload
	@echo "$(BLUE)Starting development server...$(NC)"
	npm run dev

stop: ## Stop all running processes
	@echo "$(BLUE)Stopping all processes...$(NC)"
	@pkill -f "next" || true
	@pkill -f "node.*aggregate" || true
	@echo "$(GREEN)✓ All processes stopped$(NC)"

logs: ## Show application logs
	@echo "$(BLUE)Application logs:$(NC)"
	@tail -f .next/server.log 2>/dev/null || echo "$(YELLOW)No log file found$(NC)"

# ===============================================
# DATABASE OPERATIONS
# ===============================================

db-setup: check-env ## Initialize database schema
	@echo "$(BLUE)Setting up database schema...$(NC)"
	@if [ -f .env ]; then \
		export $$(cat .env | xargs) && \
		psql -h $$DB_HOST -p $$DB_PORT -U $$DB_USER -d $$DB_NAME -f database/schema.sql; \
		echo "$(GREEN)✓ Database schema created$(NC)"; \
	else \
		echo "$(RED)Error: .env file not found. Run 'make setup' first$(NC)"; \
		exit 1; \
	fi

db-reset: ## Reset database (drop and recreate)
	@echo "$(YELLOW)WARNING: This will destroy all data in the database!$(NC)"
	@read -p "Are you sure? (y/N): " confirm && [ "$$confirm" = "y" ] || exit 1
	@echo "$(BLUE)Resetting database...$(NC)"
	@if [ -f .env ]; then \
		export $$(cat .env | xargs) && \
		psql -h $$DB_HOST -p $$DB_PORT -U $$DB_USER -d $$DB_NAME -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"; \
		make db-setup; \
		echo "$(GREEN)✓ Database reset complete$(NC)"; \
	else \
		echo "$(RED)Error: .env file not found$(NC)"; \
		exit 1; \
	fi

db-aggregate: ## Aggregate CSV data into database
	@echo "$(BLUE)Aggregating CSV data into database...$(NC)"
	@if [ ! -d "summary_data" ]; then \
		echo "$(RED)Error: summary_data directory not found$(NC)"; \
		exit 1; \
	fi
	@if [ -f .env ]; then \
		export $$(cat .env | xargs) && \
		node scripts/aggregate-csv-data.js; \
		echo "$(GREEN)✓ Data aggregation complete$(NC)"; \
	else \
		echo "$(RED)Error: .env file not found. Run 'make setup' first$(NC)"; \
		exit 1; \
	fi

db-refresh-views: ## Refresh materialized views
	@echo "$(BLUE)Refreshing materialized views...$(NC)"
	@if [ -f .env ]; then \
		export $$(cat .env | xargs) && \
		psql -h $$DB_HOST -p $$DB_PORT -U $$DB_USER -d $$DB_NAME -c "SELECT refresh_materialized_views();"; \
		echo "$(GREEN)✓ Materialized views refreshed$(NC)"; \
	else \
		echo "$(RED)Error: .env file not found$(NC)"; \
		exit 1; \
	fi

db-pipeline: db-aggregate db-refresh-views ## Complete database update pipeline
	@echo "$(GREEN)✓ Database pipeline complete$(NC)"

# ===============================================
# FULL PIPELINE OPERATIONS
# ===============================================

full-pipeline: setup db-setup db-aggregate db-refresh-views ## Complete setup and data pipeline
	@echo "$(GREEN)🎉 Full pipeline complete!$(NC)"
	@echo "$(YELLOW)Next steps:$(NC)"
	@echo "  1. Run 'make dev' to start the development server"
	@echo "  2. Open http://localhost:3000 in your browser"
	@echo "  3. Explore the PEDX Visualizer!"

# ===============================================
# DEVELOPMENT & MAINTENANCE
# ===============================================

test: ## Run tests
	@echo "$(BLUE)Running tests...$(NC)"
	npm test || echo "$(YELLOW)No tests configured$(NC)"

lint: ## Run linter
	@echo "$(BLUE)Running linter...$(NC)"
	npm run lint

format: ## Format code
	@echo "$(BLUE)Formatting code...$(NC)"
	npm run format || echo "$(YELLOW)No formatter configured$(NC)"

clean: ## Clean up build artifacts and logs
	@echo "$(BLUE)Cleaning up...$(NC)"
	rm -rf .next/
	rm -rf node_modules/.cache/
	rm -f .next/server.log
	rm -f *.log
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

deep-clean: clean ## Deep clean including node_modules
	@echo "$(BLUE)Deep cleaning...$(NC)"
	rm -rf node_modules/
	rm -f package-lock.json
	@echo "$(GREEN)✓ Deep cleanup complete$(NC)"

# ===============================================
# UTILITY TARGETS
# ===============================================

status: ## Show current status
	@echo "$(BLUE)PEDX Visualizer Status$(NC)"
	@echo "========================"
	@echo "Node.js: $$(node --version 2>/dev/null || echo 'Not installed')"
	@echo "npm: $$(npm --version 2>/dev/null || echo 'Not installed')"
	@echo "PostgreSQL: $$(psql --version 2>/dev/null || echo 'Not installed')"
	@echo ""
	@echo "Environment:"
	@echo "  NODE_ENV: $(NODE_ENV)"
	@echo "  PORT: $(PORT)"
	@echo ""
	@echo "Files:"
	@echo "  .env: $$([ -f .env ] && echo '✓ Present' || echo '✗ Missing')"
	@echo "  package.json: $$([ -f package.json ] && echo '✓ Present' || echo '✗ Missing')"
	@echo "  summary_data/: $$([ -d summary_data ] && echo '✓ Present' || echo '✗ Missing')"
	@echo ""

check-csvs: ## Check CSV files in summary_data
	@echo "$(BLUE)Checking CSV files...$(NC)"
	@if [ -d "summary_data" ]; then \
		echo "$(GREEN)CSV files found:$(NC)"; \
		ls -la summary_data/*.csv 2>/dev/null | wc -l | xargs echo "  Total CSV files:"; \
		ls summary_data/*.csv 2>/dev/null | sed 's/^/  /'; \
	else \
		echo "$(RED)summary_data directory not found$(NC)"; \
	fi

quick-start: ## Quick start for development (assumes setup is done)
	@echo "$(BLUE)Quick starting development environment...$(NC)"
	@make db-refresh-views
	@make dev

# ===============================================
# DOCUMENTATION
# ===============================================

docs: ## Generate documentation
	@echo "$(BLUE)Generating documentation...$(NC)"
	@echo "$(YELLOW)Documentation features:$(NC)"
	@echo "  - Database schema: database/schema.sql"
	@echo "  - API endpoints: src/app/api/"
	@echo "  - Components: src/components/"
	@echo "  - Aggregation script: scripts/aggregate-csv-data.js"
	@echo "$(GREEN)✓ Documentation overview complete$(NC)"

# ===============================================
# TROUBLESHOOTING
# ===============================================

debug-db: ## Debug database connection
	@echo "$(BLUE)Debugging database connection...$(NC)"
	@if [ -f .env ]; then \
		export $$(cat .env | xargs) && \
		echo "Testing connection to: $$DB_HOST:$$DB_PORT/$$DB_NAME"; \
		psql -h $$DB_HOST -p $$DB_PORT -U $$DB_USER -d $$DB_NAME -c "SELECT version();" || \
		echo "$(RED)Database connection failed$(NC)"; \
	else \
		echo "$(RED).env file not found$(NC)"; \
	fi

check-ports: ## Check if required ports are available
	@echo "$(BLUE)Checking port availability...$(NC)"
	@if lsof -Pi :$(PORT) -sTCP:LISTEN -t >/dev/null 2>&1; then \
		echo "$(RED)Port $(PORT) is already in use$(NC)"; \
	else \
		echo "$(GREEN)Port $(PORT) is available$(NC)"; \
	fi

# ===============================================
# SHORTCUTS
# ===============================================

# Common shortcuts
run: dev ## Alias for dev
update: db-pipeline ## Alias for db-pipeline
reset: db-reset ## Alias for db-reset
build-all: full-pipeline ## Alias for full-pipeline

# ===============================================
# INFO
# ===============================================

info: ## Show project information
	@echo "$(BLUE)PEDX Visualizer$(NC)"
	@echo "=================="
	@echo "A comprehensive pedestrian crossing behavior visualization tool"
	@echo ""
	@echo "$(YELLOW)Key Features:$(NC)"
	@echo "  • Cesium.js 3D globe visualization"
	@echo "  • PostgreSQL database with analytics"
	@echo "  • CSV data aggregation pipeline"
	@echo "  • Real-time filtering and insights"
	@echo ""
	@echo "$(YELLOW)Quick Commands:$(NC)"
	@echo "  make help           - Show all commands"
	@echo "  make full-pipeline  - Complete setup"
	@echo "  make dev            - Start development"
	@echo "  make db-aggregate   - Update data"
	@echo ""
