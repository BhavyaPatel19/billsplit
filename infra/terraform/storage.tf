# ---- Receipt photos ------------------------------------------------------------------------

resource "aws_s3_bucket" "receipts" {
  bucket = "${local.name}-receipts-${local.suffix}"
}

resource "aws_s3_bucket_versioning" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket                  = aws_s3_bucket.receipts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Browsers upload straight to S3 with presigned PUT URLs, so the app origin needs CORS.
resource "aws_s3_bucket_cors_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  cors_rule {
    allowed_origins = concat([local.app_url], var.extra_cors_origins)
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  rule {
    id     = "housekeeping"
    status = "Enabled"
    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ---- Database backups ----------------------------------------------------------------------

resource "aws_s3_bucket" "backups" {
  bucket = "${local.name}-backups-${local.suffix}"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-old-dumps"
    status = "Enabled"
    filter {}

    expiration {
      days = var.backup_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
}

# ---- Container images ----------------------------------------------------------------------

resource "aws_ecr_repository" "app" {
  for_each = toset(["api", "web", "worker"])

  name                 = "${local.name}/${each.key}"
  image_tag_mutability = "MUTABLE" # `latest`-style tags are moved on each deploy
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last ${var.ecr_images_to_keep} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.ecr_images_to_keep
      }
      action = { type = "expire" }
    }]
  })
}
