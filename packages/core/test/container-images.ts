/**
 * The images Testcontainers pulls for the tests, from mirrors outside Docker
 * Hub: CI runners share IPs, so anonymous Docker Hub pulls hit its rate limit
 * at random (#437). Both mirrors serve the same image as Docker Hub and need
 * no sign-in.
 */

/** Postgres 16, the oldest version the architecture supports, from Docker's official images on Amazon ECR Public. */
export const POSTGRES_IMAGE = 'public.ecr.aws/docker/library/postgres:16-alpine';

/** Ryuk, the reaper Testcontainers starts to remove containers a run leaves behind, from Testcontainers' own GitHub registry. */
export const REAPER_IMAGE = 'ghcr.io/testcontainers/ryuk:0.14.0';
