import { PrismaClient } from '@prisma/client'

// Migra usuarios desde el portal anterior a este. Conecta a AMBAS bases a la vez:
// - OLD_DATABASE_URL: conexión (pública) a la base de datos del portal anterior.
// - DATABASE_URL: la base de datos de este proyecto (la toma del entorno actual).
//
// El passwordHash se copia tal cual: es un hash argon2 autocontenido (incluye su
// propia sal), así que la clave del usuario sigue funcionando sin resetearla.
//
// department/property se re-vinculan por slug (los ids son distintos en cada base).

const oldUrl = process.env.OLD_DATABASE_URL
if (!oldUrl) {
  throw new Error('Define OLD_DATABASE_URL con la conexión pública de la base de datos anterior.')
}

const oldDb = new PrismaClient({ datasourceUrl: oldUrl })
const newDb = new PrismaClient()

async function main() {
  const oldUsers = await oldDb.user.findMany({
    include: { department: true, property: true },
  })

  let migrated = 0
  for (const u of oldUsers) {
    let departmentId: string | null = null
    if (u.department) {
      const dept = await newDb.department.findUnique({ where: { slug: u.department.slug } })
      departmentId = dept?.id ?? null
    }

    let propertyId: string | null = null
    if (u.property) {
      // La base nueva arranca sin propiedades; si no existe todavía, queda sin asignar.
      const prop = await newDb.property.findUnique({ where: { slug: u.property.slug } })
      propertyId = prop?.id ?? null
    }

    await newDb.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        fullName: u.fullName,
        email: u.email,
        passwordHash: u.passwordHash,
        role: u.role,
        avatarUrl: u.avatarUrl,
        isActive: u.isActive,
        departmentId,
        propertyId,
      },
    })
    migrated++
    console.log('Usuario migrado:', u.email)
  }

  console.log(`Listo: ${migrated}/${oldUsers.length} usuarios procesados.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await oldDb.$disconnect()
    await newDb.$disconnect()
  })
