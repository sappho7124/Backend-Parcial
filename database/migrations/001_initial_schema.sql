-- Habilitar extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. USERS
CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'MINORISTA'
        CHECK (role IN ('MINORISTA', 'MAYORISTA', 'ADMIN')),
    points INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2. PROFILES (1:1 con USERS)
CREATE TABLE public.profiles (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    full_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(20),
    address TEXT,
    document_type VARCHAR(10) CHECK (document_type IN ('CC', 'NIT', 'CE')),
    document_number VARCHAR(20),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. PRODUCTS
CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    weight_kg DECIMAL(5,2) NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0
);

-- 4. DRONE_FLEET (Se crea antes de ORDERS por la llave foránea drone_id)
CREATE TABLE public.drone_fleet (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model VARCHAR(50) NOT NULL,
    max_weight_kg DECIMAL(4,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'MAINTENANCE', 'FLIGHT')),
    last_maintenance DATE
);

-- 5. ORDERS
CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    drone_id UUID REFERENCES public.drone_fleet(id) ON DELETE SET NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    delivery_vehicle VARCHAR(20)
        CHECK (delivery_vehicle IN ('DRONE', 'MOTORCYCLE', 'BICYCLE')),
    delivery_pin VARCHAR(6),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 6. ORDER_ITEMS
CREATE TABLE public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL
);

-- 7. INVOICES
CREATE TABLE public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    pdf_url TEXT NOT NULL,
    issued_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 8. PAYMENTS
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL DEFAULT 'EPAYCO',
    provider_ref VARCHAR(100) UNIQUE,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'COP',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REFUNDED')),
    webhook_payload JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 9. GPS_TRACKING
CREATE TABLE public.gps_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    vehicle_type VARCHAR(20)
        CHECK (vehicle_type IN ('DRONE', 'MOTORCYCLE', 'BICYCLE')),
    recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 10. LOYALTY_POINTS
CREATE TABLE public.loyalty_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    points_delta INTEGER NOT NULL,
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('EARNED', 'REDEEMED', 'EXPIRED')),
    description VARCHAR(200),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 11. MAINTENANCE_LOGS
CREATE TABLE public.maintenance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drone_id UUID NOT NULL REFERENCES public.drone_fleet(id) ON DELETE CASCADE,
    maintenance_type VARCHAR(50) NOT NULL,
    description TEXT,
    performed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    next_due_date DATE,
    technician VARCHAR(100)
);

-- Bucket de Supabase Storage para facturas PDF
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', true)
ON CONFLICT (id) DO NOTHING;