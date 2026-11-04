# Aqua Home Appliance — Business Management System

A centralized business management system for managing product inventory, tracking customer & vendor ledgers, generating downloadable PDF invoices and account statements, calculating assembly costs, and monitoring business financial performance.

---

## Key Features

### 1. Product Inventory Management
- **Catalog**: Track raw materials, components, trading items, and assembled products.
- **Automated Stock Updates**: Stock levels automatically adjust upon sales, purchases, and assembly runs.
- **Valuation**: Live weighted average cost price and total inventory value calculations.
- **Stock Movements Audit**: Traceable movement history for every product (sales, purchases, assemblies, opening stock, adjustments).
- **Stock Reorder Alerts**: Visual warnings when stock falls below defined thresholds.

### 2. Customer Ledger & Downloadable Invoices
- **Individual Accounts**: Dedicated ledger for every customer with running balance.
- **Invoice Generation & PDF Download**: Generate professional, branded PDF invoices with:
  - Business letterhead & contact details
  - Billed customer information
  - Account statement summary (Previous balance, Invoice charges, Upfront payments, Remaining balance)
  - Detailed line items, unit rates, and totals
  - Amount in words (Rupees / Lakhs / Crores)
  - Official PAID / PARTIALLY PAID / UNPAID stamps
  - Terms & conditions and authorized signature lines
- **Account Statements**: One-click download of full customer ledger statements in PDF format.
- **Payment Receipts**: Record payments received via Cash, Bank Transfer, Cheque, or Online channels.

### 3. Vendor / Supplier Ledger
- **Vendor Accounts**: Maintain accounts for suppliers and parts vendors.
- **Purchase Bills**: Record supplier bills with vendor bill numbers and landed costs.
- **Balances Owed**: Easily see how much the business owes each supplier.
- **Downloadable Vendor Statements**: Account statement PDFs for supplier reconciliation.

### 4. Product Assembly & Cost Calculation
- **Bill of Materials (BOM)**: Define component recipes for manufactured products (e.g., RO Water Purifiers).
- **Accurate Cost Calculation**: Calculates material cost directly from current inventory average costs, adding per-unit labor and overhead expenses.
- **Max Buildable Capacity**: Live calculation of how many units can be assembled given current raw material stocks.
- **Assembly Production Run**: Deducts components from stock and adds finished goods into inventory at the computed unit cost.

### 5. Main Dashboard & Analytics
- **Financial KPIs**: Total Revenue, Gross Profit, Inventory Valuation, Net Business Position (Inventory + Receivables - Payables).
- **Dues Monitoring**: Total Customer Dues (Receivables) and Vendor Dues (Payables).
- **Performance Trends**: Interactive charts showing Sales vs. Purchases and Profit by Day, Week, Month, or Year.
- **Stock Alerts & Quick Debtor/Creditor lists**.

### 6. Business Calendar & Activity History
- **Interactive Calendar**: Navigate by month and click any date to view all activities recorded on that day.
- **Daily Operations Feed**: View daily sales, purchases, customer payments, vendor payments, stock changes, and assembly runs.
- **Instant Document Links**: Open and download invoices directly from any calendar entry.

### 7. Reports & Centralized Export
- **12 Ready-Made Reports**:
  - Inventory Valuation & Stock Levels
  - Sales Register & Line-Item Sales by Product
  - Purchases Register & Line-Item Purchases
  - Outstanding Balances (Receivables & Payables)
  - Payments In & Out
  - Product Assembly Cost Breakdown
  - Stock Movement Audit Log
  - Operating Expenses
  - Profit & Loss Statement (P&L)
- **Multi-Format Export**: Download any report instantly as **PDF**, **Excel (.xlsx)**, or **CSV**.

### 8. Centralized Database & Security
- **Single SQLite Database File**: `data/business.db` contains all records with zero external cloud dependencies.
- **One-Click Backup**: Download the entire business database file anytime from Settings.
- **Owner Authentication**: Secure password protection with scrypt hashing.

---

## Quick Start Guide

### Prerequisites
- Node.js (v18+)

### Running Locally

```bash
# 1. Start both backend and frontend servers together:
npm run dev
```

- **Frontend App**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:5174](http://localhost:5174)

### Production Build

```bash
# Build frontend bundle
npm run build

# Start production server (serves both API and frontend bundle)
npm start
```
