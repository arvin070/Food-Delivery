terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type        = string
  description = "AWS region containing the private app host and database."
}

variable "environment" {
  type        = string
  description = "Independent deployment environment name."
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "vpc_id" {
  type        = string
  description = "VPC containing private database subnets and the Lunch host security group."
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "At least two private subnet IDs in separate availability zones."
  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "RDS requires at least two private subnets."
  }
}

variable "app_host_security_group_id" {
  type        = string
  description = "Security group attached to the dedicated Lunch Docker host."
}

variable "instance_class" {
  type        = string
  description = "Choose an instance size appropriate to this environment."
  default     = "db.t4g.small"
}

variable "engine_version" {
  type        = string
  description = "Approved PostgreSQL 16 minor version available in the selected AWS region."
}

variable "multi_az" {
  type        = bool
  description = "Enable synchronous standby for production availability."
  default     = true
}

variable "backup_retention_days" {
  type        = number
  description = "Automated snapshot and point-in-time recovery retention."
  default     = 14
  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "Use a managed backup retention between 7 and 35 days."
  }
}

resource "aws_security_group" "postgres" {
  name        = "lunch-${var.environment}-postgres"
  description = "Private PostgreSQL ingress from the dedicated Lunch app host only."
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from the Lunch app host security group"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.app_host_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Application = "Lunch", Environment = var.environment }
}

resource "aws_db_subnet_group" "postgres" {
  name       = "lunch-${var.environment}-postgres"
  subnet_ids = var.private_subnet_ids
  tags       = { Application = "Lunch", Environment = var.environment }
}

resource "aws_db_parameter_group" "postgres" {
  name   = "lunch-${var.environment}-postgres16"
  family = "postgres16"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "immediate"
  }
}

resource "aws_db_instance" "postgres" {
  identifier                  = "lunch-${var.environment}"
  engine                      = "postgres"
  engine_version              = var.engine_version
  instance_class              = var.instance_class
  allocated_storage           = 50
  max_allocated_storage       = 500
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = "lunch"
  username                    = "lunch_admin"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.postgres.name
  vpc_security_group_ids      = [aws_security_group.postgres.id]
  parameter_group_name        = aws_db_parameter_group.postgres.name
  publicly_accessible         = false
  backup_retention_period     = var.backup_retention_days
  backup_window               = "19:00-20:00"
  maintenance_window          = "sun:20:00-sun:21:00"
  multi_az                    = var.multi_az
  auto_minor_version_upgrade  = true
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "lunch-${var.environment}-final"
  copy_tags_to_snapshot       = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = { Application = "Lunch", Environment = var.environment }

  lifecycle {
    prevent_destroy = true
  }
}

output "database_host" {
  value       = aws_db_instance.postgres.address
  description = "Private RDS endpoint; allowlisted only from the app host security group."
}

output "database_name" {
  value = aws_db_instance.postgres.db_name
}

output "master_secret_arn" {
  value       = aws_db_instance.postgres.master_user_secret[0].secret_arn
  description = "Retrieve only for break-glass administration; never use as application DATABASE_URL."
}
